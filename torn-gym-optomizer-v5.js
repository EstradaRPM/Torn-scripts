// ==UserScript==
// @name         Torn Gym Optimizer — NC17
// @namespace    NC17-GymOptimizer-v5
// @version      5.9.0
// @description  Multi-month gym planning with real-time energy tracking and daily progress
// @author       Built for NC17 [1171127]
// @match        https://www.torn.com/*
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-gym-optomizer-v5.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-gym-optomizer-v5.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const API_KEY = '###PDA-APIKEY###';
  const SCRIPT_VERSION = '5.9.0';

  // Set to true to display the panel on any torn.com page (for use while not on gym.php).
  // Set to false to restrict to gym.php only.
  const TEST_MODE = true;

  const Store = {
    get(k)    { try { return localStorage.getItem(k); }    catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); }        catch {} },
  };
  const KEYS = { ROT: 'nc17_rot', SET: 'nc17_set', COL: 'nc17_col', SNAP: 'nc17_snap', XBONUS: 'nc17_xbonus', ELOG: 'nc17_elog', ETST: 'nc17_etstate' };

  const MEM = {
    view: 'main', collapsed: false,
    stats: null, energy: null, happy: null, settings: null, schedule: null, snap: null,
    fetchError: null, fetchStarted: null,
    extraBonus: null, extraBonusSource: null, // null until fetch completes; source = 'api'|'cache'|'manual'
    // Daily energy tracking (TCT-aligned)
    lastTctDate: null, dayStartE: null, prevE: null,
  };

  const DEFAULTS = {
    primaryGym:   'isoyamas',
    secondaryGym: 'frontline',
    ignoredStats: { def: false, str: false, spd: false, dex: true },
    safetyM:      15,
    baseRegen:    600,
    xanaxPerDay:  0,
    // STR/SPD ratio targets as % of total stats (DEX = 0 since ignored)
    ratioTargets: { def: 40, str: 28, spd: 28, dex: 4 },
    // Manual fallback used only when the education/properties API fetch fails
    extraBonusPct: 4,
  };

  const GYMS = {
    isoyamas:     { def: 8.0, str: null, spd: null, dex: null },
    frontline:    { def: null, str: 7.5, spd: 7.5,  dex: null },
    gym3000:      { str: 8.0, def: null, spd: null,  dex: null },
    totalrebound: { spd: 8.0, def: null, str: null,  dex: null },
    balboas:      { def: 7.5, dex: 7.5, str: null,   spd: null },
    elites:       { dex: 8.0, def: null, str: null,   spd: null },
    georges:      { def: 7.3, str: 7.3, spd: 7.3,    dex: 7.3  },
  };

  const GYM_ENERGY = {
    isoyamas: 50, gym3000: 50, totalrebound: 50, elites: 50,
    frontline: 25, balboas: 25, georges: 10,
  };

  const GYM_NAME = {
    isoyamas: "Mr. Isoyama's", frontline: 'Frontline Fitness',
    gym3000: 'Gym 3000', totalrebound: 'Total Rebound',
    balboas: "Balboa's", elites: 'Elites', georges: "George's",
  };

  const HANKS = { def: 36, str: 28.5, spd: 28.5, dex: 7 };

  const LABEL = { def: 'Defense', str: 'Strength', spd: 'Speed', dex: 'Dexterity' };
  const COLOR = { def: '#60aaff', str: '#ff7060', spd: '#40e880', dex: '#ffcc40' };
  const STATS  = ['def', 'str', 'spd', 'dex'];

  // ── GYM HELPERS ──────────────────────────────────────────────────────────────
  function bestGym(stat, pg, sg) {
    if (GYMS[pg]?.[stat] != null) return pg;
    if (GYMS[sg]?.[stat] != null) return sg;
    return 'georges';
  }

  function effMult(stat, buffs, pg, sg) {
    const g = bestGym(stat, pg, sg);
    const dots = GYMS[g][stat] || 0;
    return dots * (1 + (buffs?.[stat] || 0) / 100);
  }

  // ── HEADROOM ─────────────────────────────────────────────────────────────────
  function headrooms(s) {
    const isoCeil = s.def / 1.25;
    const flCeil  = (s.str + s.spd) / 1.25;
    return {
      def: Math.max(0, flCeil  - s.dex - s.def),
      str: Math.max(0, isoCeil - s.str),
      spd: Math.max(0, isoCeil - s.spd),
      dex: Math.max(0, flCeil  - s.def - s.dex),
    };
  }

  function gymOpen(s) {
    return {
      fl:  (s.str + s.spd) >= 1.25 * (s.def + s.dex),
      iso: s.def >= 1.25 * Math.max(s.str, s.spd, s.dex),
    };
  }

  // ── MULTI-MONTH PLANNER ───────────────────────────────────────────────────────
  //
  // Gain model (matched to spreadsheet formula):
  //   statScaled = stat < 50M ? stat : (stat-50M)/(8.77635*log10(stat))+50M
  //   happyFactor = round(1 + 0.07 * round(ln(1 + happy/250), 4), 4)
  //   inner = statScaled * happyFactor + 8*happy^1.05 + C1*(1-(happy/99999)^2) + C2
  //   gain_per_train = (1/200000) * dots * ePerTrain * (1+buffPct/100) * inner
  //
  //   DEF (Isoyama's):   C1=2100, C2=-600
  //   STR (Frontline):   C1=1600, C2=1700
  //   SPD (Frontline):   C1=1600, C2=2000
  //   DEX (Elites/George's): C1=1800, C2=1500
  //
  // Planning logic (in priority order):
  //
  // 1. Identify PEAK stats each month = those with the highest steadfast buff.
  //
  // 2. HEADROOM UNLOCK weighting: among peak stats, if training one stat
  //    directly creates headroom for a DIFFERENT stat that is the target of a
  //    FUTURE month, weight toward the unlocking stat proportionally to how much
  //    headroom the next month needs. This is why DEF gets extra weight in April
  //    even when STR is also peak — every DEF train adds 1/1.25 of SPD headroom
  //    needed for May.
  //
  // 3. RATIO imbalance weighting: among stats sharing the same gym, weight
  //    toward whichever is further below its ratio target.
  //
  // 4. FEASIBILITY CAP: if projected headroom for next month is insufficient
  //    even training the unlocking stat exclusively, show the achievable % and
  //    plan for what's actually possible, not an impossible ideal.
  //
  // 5. FORCED training: only if a non-peak stat will breach a constraint that
  //    the peak stats cannot unlock (e.g. STR growing faster than DEF in a month
  //    where only STR is peak and Isoyama's would close).

  // Torn API identifiers for auto-detected training bonuses.
  // Verify SPORTS_SCIENCE_ID by calling: api.torn.com/torn/?selections=education&key=...
  // and finding the Sports Science course entry.
  // Verify POOL_UPGRADE_KEY by calling: api.torn.com/user/?selections=properties&key=...
  // and inspecting the upgrades object on a property that has the pool training upgrade.
  const SPORTS_SCIENCE_ID = 10;   // ← confirm this ID from your API response
  const POOL_UPGRADE_KEY  = 'pool'; // ← confirm this key from your API response

  const HAPPY_EST = 5000;

  // Daily energy = base natural regen + fixed 150E daily points refill + xanax × 250E each
  function computeDailyEnergy(s) {
    return Math.round((s.baseRegen ?? 600) + 150 + (s.xanaxPerDay ?? 0) * 250);
  }

  // Per-stat constants [C1, C2] for the gain formula inner term.
  const GAIN_CONSTS = {
    def: [2100,  -600],
    str: [1600,  1700],
    spd: [1600,  2000],
    dex: [1800,  1500],
  };

  function gainPerTrain(stat, statVal, buffPct, gymKey) {
    const dots = GYMS[gymKey]?.[stat] || 0;
    if (!dots) return 0;
    const ePerTrain = GYM_ENERGY[gymKey];
    // Use real happiness from API when available; fall back to estimate only if not yet fetched
    const happy = MEM.happy ?? HAPPY_EST;

    // Diminishing-return cap on stat value above 50M (mirrors spreadsheet IF clause)
    const statScaled = statVal < 50_000_000
      ? statVal
      : (statVal - 50_000_000) / (8.77635 * Math.log10(statVal)) + 50_000_000;

    // Happy factor: mirrors ROUND(1+0.07*ROUND(LN(1+happy/250),4),4) in spreadsheet
    const lnTerm     = Math.round(Math.log(1 + happy / 250) * 10000) / 10000;
    const happyFactor = Math.round((1 + 0.07 * lnTerm) * 10000) / 10000;

    const [C1, C2] = GAIN_CONSTS[stat] ?? GAIN_CONSTS.str;
    const inner = statScaled * happyFactor
      + 8 * Math.pow(happy, 1.05)
      + C1 * (1 - Math.pow(happy / 99999, 2))
      + C2;

    // extraBonus: pool + sports science fetched from API; falls back to manual setting while pending
    const extraBonus = MEM.extraBonus ?? (MEM.settings?.extraBonusPct ?? 0);
    return (1 / 200000) * dots * ePerTrain * (1 + (buffPct + extraBonus) / 100) * inner;
  }

  function projGain(stat, statVal, buffPct, gymKey, energy) {
    const ePerTrain = GYM_ENERGY[gymKey];
    const trains = Math.floor(energy / ePerTrain);
    return gainPerTrain(stat, statVal, buffPct, gymKey) * trains;
  }

  function ratioOf(s) {
    const t = s.def + s.str + s.spd + s.dex;
    if (!t) return { def:0, str:0, spd:0, dex:0 };
    return { def: s.def/t*100, str: s.str/t*100, spd: s.spd/t*100, dex: s.dex/t*100 };
  }

  function planHorizon(startStats, schedule, settings) {
    const ignored   = settings.ignoredStats || {};
    const safetyPts = (settings.safetyM || 15) * 1e6;
    const dailyE    = computeDailyEnergy(settings);
    const ratio     = settings.ratioTargets || HANKS;
    const active    = STATS.filter(s => !ignored[s]);

    const GYM_FOR = {
      def: settings.primaryGym,
      str: settings.secondaryGym,
      spd: settings.secondaryGym,
      dex: 'georges',
    };

    const now = new Date();

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Basic per-month facts derived purely from schedule position and date.
    // Returns null for months that fall before the current month.
    function monthBasics(mi) {
      const rot = schedule[mi];
      const [ry, rm] = rot.month.split('-').map(Number);
      if (ry < now.getFullYear() || (ry === now.getFullYear() && rm - 1 < now.getMonth())) return null;
      const buffs       = rot.buffs || { def:0, str:0, spd:0, dex:0 };
      const daysInMonth = new Date(ry, rm, 0).getDate();
      const isCurrent   = (ry === now.getFullYear() && rm - 1 === now.getMonth());
      const days        = isCurrent ? (daysInMonth - now.getDate() + 1) : daysInMonth;
      const totalE      = dailyE * days;
      const maxBuff     = Math.max(...active.map(s => buffs[s] || 0));
      const peakStats   = active.filter(s => (buffs[s] || 0) === maxBuff);
      const nonPeakStats = active.filter(s => !peakStats.includes(s));
      return { rot, ry, rm, buffs, isCurrent, days, totalE, maxBuff, peakStats, nonPeakStats };
    }

    // For 2-peak months: α is the fraction of totalE assigned to peakStats[0].
    // The remainder (after train-multiple clamping of A) flows to peakStats[1].
    // For other peak counts: falls back to equal energy per stat.
    function splitsFromAlpha(α, peakStats, totalE) {
      const sp = { def:0, str:0, spd:0, dex:0 };
      if (peakStats.length === 2) {
        const [A, B] = peakStats;
        const eA = GYM_ENERGY[GYM_FOR[A]];
        const eB = GYM_ENERGY[GYM_FOR[B]];
        sp[A] = Math.floor(α * totalE / eA) * eA;
        sp[B] = Math.floor((totalE - sp[A]) / eB) * eB;
      } else {
        const n = Math.max(1, peakStats.length);
        for (const s of peakStats) {
          const e = GYM_ENERGY[GYM_FOR[s]];
          sp[s] = Math.floor(totalE / n / e) * e;
        }
      }
      return sp;
    }

    // Project end-of-month stats for peak stats only (no forced training).
    function projectPeak(base, splits, peakStats, buffs) {
      const proj = { ...base };
      for (const s of peakStats) {
        if (!splits[s]) continue;
        proj[s] = (proj[s] || 0) + projGain(s, base[s] || 1e6, buffs[s] || 0, GYM_FOR[s], splits[s]);
      }
      return proj;
    }

    // Buff-weighted gain contribution for one month's peak stats.
    function localScore(base, splits, peakStats, buffs) {
      let sc = 0;
      for (const s of peakStats) {
        const buffPct = buffs[s] || 0;
        sc += projGain(s, base[s] || 1e6, buffPct, GYM_FOR[s], splits[s] || 0) * (1 + buffPct / 100);
      }
      return sc;
    }

    // ── Phase 1: coordinate descent over α values (2-peak months only) ───────
    //
    // For each 2-peak month we search α ∈ {0.0, 0.1, …, 1.0} that maximises
    //   localScore(month mi) + scoreHorizon(projStats, schedule[mi+1..], settings)
    // while holding every other month's α fixed. We sweep in order and repeat
    // until no α changes or 12 outer iterations complete.
    const ALPHAS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const alphas = new Array(schedule.length).fill(0.5); // initial: equal split

    for (let iter = 0; iter < 12; iter++) {
      let changed = false;
      let cur = { ...startStats };

      for (let mi = 0; mi < schedule.length; mi++) {
        const info = monthBasics(mi);
        if (!info) continue;
        const { peakStats, buffs, totalE } = info;

        if (peakStats.length !== 2) {
          // No α dimension; advance cur with equal-split approximation and continue.
          cur = projectPeak(cur, splitsFromAlpha(0.5, peakStats, totalE), peakStats, buffs);
          continue;
        }

        let bestAlpha = alphas[mi];
        let bestScore = -Infinity;

        for (const α of ALPHAS) {
          const sp  = splitsFromAlpha(α, peakStats, totalE);
          const proj = projectPeak(cur, sp, peakStats, buffs);
          const sc   = localScore(cur, sp, peakStats, buffs)
                     + scoreHorizon(proj, schedule.slice(mi + 1), settings);
          if (sc > bestScore) { bestScore = sc; bestAlpha = α; }
        }

        if (bestAlpha !== alphas[mi]) { alphas[mi] = bestAlpha; changed = true; }
        cur = projectPeak(cur, splitsFromAlpha(bestAlpha, peakStats, totalE), peakStats, buffs);
      }

      if (!changed) break;
    }

    // ── Phase 2: final pass — build months[] with optimal splits ──────────────
    let simStats    = { ...startStats };
    let prevSimStats = null;  // tracks prior month's entry stats for "growing" check
    const months    = [];

    for (let mi = 0; mi < schedule.length; mi++) {
      const info = monthBasics(mi);
      if (!info) continue;
      const { rot, ry, rm, buffs, isCurrent, days, totalE, maxBuff, peakStats, nonPeakStats } = info;

      // Step 2: look ahead — what does next month need?
      const nextRot = schedule.find((r, i) => {
        if (i <= mi) return false;
        const [ny, nm] = r.month.split('-').map(Number);
        return ny > ry || nm > rm;
      });
      const nextHeadroomNeeded = {};
      if (nextRot) {
        const nextBuffs    = nextRot.buffs || {};
        const nextMaxBuff  = Math.max(...active.map(s => nextBuffs[s] || 0));
        const nextPeakStats = active.filter(s => (nextBuffs[s]||0) === nextMaxBuff);
        const [ny, nm]     = nextRot.month.split('-').map(Number);
        const nextTotalE   = dailyE * new Date(ny, nm, 0).getDate();
        for (const ns of nextPeakStats) {
          const gk    = GYM_FOR[ns];
          const trains = Math.floor(nextTotalE / GYM_ENERGY[gk] / nextPeakStats.length);
          const growth = gainPerTrain(ns, simStats[ns]||1e6, nextBuffs[ns]||0, gk) * trains;
          nextHeadroomNeeded[ns] = growth + safetyPts;
        }
      }

      // Step 3: weights (same heuristic as before; still drives topTwo and output field)
      const curRatios = ratioOf(simStats);
      const hd        = headrooms(simStats);
      const weights   = {};
      for (const s of peakStats) {
        weights[s] = 1.0;
        weights[s] += Math.max(0, (ratio[s]||0) - curRatios[s]) * 0.3;
        for (const [ns, needed] of Object.entries(nextHeadroomNeeded)) {
          const gap = Math.max(0, needed - (hd[ns] || 0));
          if (gap <= 0) continue;
          let unlockRate = 0;
          if ((ns === 'spd' || ns === 'str') && s === 'def') unlockRate = 1 / 1.25;
          if (ns === 'def' && (s === 'str' || s === 'spd'))  unlockRate = 1 / 1.25;
          if (unlockRate > 0) {
            const maxGain    = projGain(s, simStats[s]||1e6, buffs[s]||0, GYM_FOR[s], totalE);
            const unlockFrac = gap > 0 ? Math.min(gap, maxGain * unlockRate) / gap : 0;
            weights[s]      += unlockFrac * 2.0;
          }
        }
      }

      // Greedy splits (weight-based; same logic as the original planHorizon).
      // Used as the baseline for scoreDelta and as the split for non-2-peak months.
      const greedySplits = { def:0, str:0, spd:0, dex:0 };
      {
        const tw = Object.values(weights).reduce((a,b)=>a+b,0) || 1;
        peakStats.forEach(s => { greedySplits[s] = Math.round((weights[s]/tw) * totalE); });
        for (const s of peakStats) {
          const e = GYM_ENERGY[GYM_FOR[s]];
          greedySplits[s] = Math.floor(greedySplits[s] / e) * e;
        }
        const gsRem = totalE - peakStats.reduce((a,s)=>a+greedySplits[s],0);
        if (gsRem > 0 && peakStats.length) {
          const top = [...peakStats].sort((a,b)=>weights[b]-weights[a])[0];
          const e   = GYM_ENERGY[GYM_FOR[top]];
          greedySplits[top] += Math.floor(gsRem / e) * e;
        }
      }

      // Final splits: α-derived for 2-peak months, greedy for all others.
      const splits = peakStats.length === 2
        ? splitsFromAlpha(alphas[mi], peakStats, totalE)
        : { ...greedySplits };

      // New fields: α that won the search, and score improvement vs greedy.
      let alphaUsed  = null;
      let scoreDelta = 0;
      if (peakStats.length === 2) {
        alphaUsed  = alphas[mi];
        const rest = schedule.slice(mi + 1);
        scoreDelta = scoreHorizon(projectPeak(simStats, splits,        peakStats, buffs), rest, settings)
                   - scoreHorizon(projectPeak(simStats, greedySplits,  peakStats, buffs), rest, settings);
      }

      // Step 4: project end-of-month stats with final splits
      const projStats = { ...simStats };
      for (const s of active) {
        if (!splits[s]) continue;
        projStats[s] = (projStats[s]||0) + projGain(s, simStats[s]||1e6, buffs[s]||0, GYM_FOR[s], splits[s]);
      }

      // Step 5: forced minimum for non-peak stats only if headroom gap can't be
      // covered by peak stat training
      const forcedTraining = {};
      const forcedReasons  = [];
      for (const ns of nonPeakStats) {
        const hd2 = headrooms(projStats);
        if (hd2[ns] >= safetyPts) continue;
        const gk       = GYM_FOR[ns];
        const ePerTrain = GYM_ENERGY[gk];
        const gap      = safetyPts - hd2[ns];
        const gainPT   = gainPerTrain(ns, projStats[ns]||1e6, buffs[ns]||0, gk);
        if (gainPT > 0) {
          const trainsNeeded = Math.ceil(gap / (gainPT / 1.25));
          const energyNeeded = trainsNeeded * ePerTrain;
          if (energyNeeded > 0) {
            forcedTraining[ns] = energyNeeded;
            forcedReasons.push(`${LABEL[ns]}: ${trainsNeeded} trains (${GYM_NAME[gk]}) to maintain gym access`);
            const topPeak = [...peakStats].sort((a,b)=>splits[b]-splits[a])[0];
            if (topPeak) splits[topPeak] = Math.max(0, splits[topPeak] - energyNeeded);
            splits[ns] = (splits[ns]||0) + energyNeeded;
            projStats[ns] = (projStats[ns]||0) + projGain(ns, simStats[ns]||1e6, buffs[ns]||0, gk, energyNeeded);
          }
        }
      }

      // Step 5.5: corrective training — for each ratio-deficient non-peak stat that
      // is growing vs the prior month and has a future peak month in the schedule,
      // try diverting 10% of energy to it. Accept when the forward-score improvement
      // exceeds 1.5× the opportunity cost (gain lost on the top peak stat).
      const correctiveTraining = {};
      {
        const curRatiosCorr = ratioOf(simStats);
        const remaining     = schedule.slice(mi + 1);
        let   scoreBase     = scoreHorizon(projStats, remaining, settings);

        for (const ns of nonPeakStats) {
          // Condition 1: ratio deficit ≥ 2.5 percentage points below target
          const deficit = (ratio[ns] || 0) - (curRatiosCorr[ns] || 0);
          if (deficit < 2.5) continue;

          // Condition 2: stat grew vs prior month (requires prior data)
          if (prevSimStats === null) continue;
          if ((simStats[ns] || 0) <= (prevSimStats[ns] || 0)) continue;

          // Condition 3: a future non-past month exists where ns is a peak stat
          const hasFuturePeak = remaining.some(r => {
            const [fy, fm] = r.month.split('-').map(Number);
            if (fy < now.getFullYear() || (fy === now.getFullYear() && fm - 1 < now.getMonth())) return false;
            const fb   = r.buffs || {};
            const fmax = Math.max(...active.map(s => fb[s] || 0));
            return (fb[ns] || 0) === fmax;
          });
          if (!hasFuturePeak) continue;

          // Pick top peak stat by current split allocation (updated across loop iterations)
          const topPeak = [...peakStats].sort((a,b) => (splits[b]||0) - (splits[a]||0))[0];
          if (!topPeak || (splits[topPeak] || 0) <= 0) continue;

          // Corrective energy: 10% of totalE clamped to ns's gym train-size
          const gkNs       = GYM_FOR[ns];
          const correctiveE = Math.floor(0.1 * totalE / GYM_ENERGY[gkNs]) * GYM_ENERGY[gkNs];
          if (correctiveE <= 0) continue;

          // Opportunity cost: peak-stat gain lost by diverting correctiveE away
          const gkPeak   = GYM_FOR[topPeak];
          const peakLost = projGain(topPeak, simStats[topPeak] || 1e6, buffs[topPeak] || 0, gkPeak, correctiveE);

          // Corrective gain for ns with the diverted energy
          const correctiveGain = projGain(ns, projStats[ns] || 1e6, buffs[ns] || 0, gkNs, correctiveE);

          // Simulate the adjusted end-of-month stats and score the forward horizon
          const projWith = { ...projStats };
          projWith[ns]      = (projWith[ns]      || 0) + correctiveGain;
          projWith[topPeak] = Math.max(0, (projWith[topPeak] || 0) - peakLost);

          const scoreWith = scoreHorizon(projWith, remaining, settings);
          if (scoreWith > scoreBase + 1.5 * peakLost) {
            // Accept: commit the corrective adjustment to projStats and splits
            projStats[ns]      = projWith[ns];
            projStats[topPeak] = projWith[topPeak];
            splits[topPeak]    = Math.max(0, (splits[topPeak] || 0) - correctiveE);
            splits[ns]         = (splits[ns]  || 0) + correctiveE;
            scoreBase = scoreWith; // raise bar for any subsequent stats
            const trains = Math.floor(correctiveE / GYM_ENERGY[gkNs]);
            correctiveTraining[ns] = {
              energy: correctiveE, trains, gym: gkNs,
              reason: `${LABEL[ns]} ${(curRatiosCorr[ns]||0).toFixed(1)}% vs ${(ratio[ns]||0).toFixed(1)}% target — ${trains} corrective trains at ${GYM_NAME[gkNs]}`,
            };
          }
        }
      }

      // Projected end-of-month stat ratios (after all training including corrective)
      const projRatios = ratioOf(projStats);

      // Step 6: headroom feasibility for next month's targets
      const feasibility = {};
      if (nextRot) {
        const projHd = headrooms(projStats);
        for (const [ns, needed] of Object.entries(nextHeadroomNeeded)) {
          const available = projHd[ns] || 0;
          feasibility[ns] = {
            needed,
            available,
            pct: Math.min(100, Math.round(available / needed * 100)),
            ok: available >= needed,
          };
        }
      }

      // Step 7: breach check
      const projH    = headrooms(projStats);
      const breaches = [];
      for (const s of active) {
        if (projH[s] < safetyPts)
          breaches.push({ stat: s, room: projH[s], gym: s==='def'?'Frontline':"Isoyama's" });
      }

      // topTwo: highest-weighted peak stats (for Now instruction display)
      const topTwo = [...peakStats]
        .sort((a,b) => (weights[b]||0) - (weights[a]||0))
        .slice(0, 2)
        .map(s => ({ stat: s, gym: GYM_FOR[s] }));

      months.push({
        month: rot.month, label: rot.label||rot.month, buffs, days, totalE,
        peakStats, topTwo, splits, weights, forcedTraining, forcedReasons,
        projStats, breaches, feasibility, isCurrent, GYM_FOR, maxBuff,
        alphaUsed, scoreDelta, correctiveTraining, projRatios,
      });
      prevSimStats = simStats;
      simStats     = projStats;
    }

    return months;
  }

  // Returns a scalar quality score for a given schedule+settings combination.
  // Higher is better. Used to compare candidate plans without rendering.
  //
  // Score = Σ (gain × (1 + buffPct/100)) for all peak stats across all months
  //       − Σ headroom shortfalls × 5.0          (per stat per month)
  //       − Σ George's-fallback opportunity cost × 2.0  (preferred gym was capable but closed)
  //       − Σ end-of-horizon ratio deficit (pp) × totalStats × 0.01
  function scoreHorizon(simStats, schedule, settings) {
    const ignored   = settings.ignoredStats || {};
    const safetyPts = (settings.safetyM || 15) * 1e6;
    const dailyE    = computeDailyEnergy(settings);
    const ratio     = settings.ratioTargets || HANKS;
    const active    = STATS.filter(s => !ignored[s]);
    const pg        = settings.primaryGym;
    const sg        = settings.secondaryGym;

    // Isoyama's and Frontline have headroom-gated access; all others are always open.
    const gymIsOpen = (gymKey, open) => {
      if (gymKey === 'isoyamas') return open.iso;
      if (gymKey === 'frontline') return open.fl;
      return true;
    };

    let cur = { ...simStats };
    const now = new Date();
    let score = 0;

    for (let mi = 0; mi < schedule.length; mi++) {
      const rot = schedule[mi];
      const [ry, rm] = rot.month.split('-').map(Number);
      // Skip months before current
      if (ry < now.getFullYear() || (ry === now.getFullYear() && rm - 1 < now.getMonth())) continue;

      const buffs       = rot.buffs || { def: 0, str: 0, spd: 0, dex: 0 };
      const daysInMonth = new Date(ry, rm, 0).getDate();
      const isCurrent   = (ry === now.getFullYear() && rm - 1 === now.getMonth());
      const days        = isCurrent ? (daysInMonth - now.getDate() + 1) : daysInMonth;
      const totalE      = dailyE * days;

      // Peak stats = those tied for highest buff this month
      const maxBuff   = Math.max(...active.map(s => buffs[s] || 0));
      const peakStats = active.filter(s => (buffs[s] || 0) === maxBuff);
      const ePerStat  = peakStats.length ? Math.floor(totalE / peakStats.length) : 0;

      const open      = gymOpen(cur);
      const projStats = { ...cur };

      for (const s of peakStats) {
        const buffPct  = buffs[s] || 0;
        const pgTrains = GYMS[pg]?.[s] != null;
        const sgTrains = GYMS[sg]?.[s] != null;

        // Resolve gym: primary → secondary → George's
        let gymKey = 'georges';
        let georgesFallback = false;
        if (pgTrains && gymIsOpen(pg, open)) {
          gymKey = pg;
        } else if (sgTrains && gymIsOpen(sg, open)) {
          gymKey = sg;
        } else {
          gymKey = 'georges';
          // Fallback: preferred gym can train this stat but is currently closed
          if (pgTrains || sgTrains) georgesFallback = true;
        }

        const trains = Math.floor(ePerStat / GYM_ENERGY[gymKey]);
        const gain   = gainPerTrain(s, cur[s] || 1e6, buffPct, gymKey) * trains;

        // Buff-weighted gain contribution
        score += gain * (1 + buffPct / 100);

        // George's fallback penalty: opportunity cost of the closed preferred gym × 2.0
        if (georgesFallback) {
          const preferredGym = pgTrains ? pg : sg;
          const prefTrains   = Math.floor(ePerStat / GYM_ENERGY[preferredGym]);
          const lostGain     = Math.max(0,
            gainPerTrain(s, cur[s] || 1e6, buffPct, preferredGym) * prefTrains - gain
          );
          score -= lostGain * 2.0;
        }

        projStats[s] = (projStats[s] || 0) + gain;
      }

      // Headroom violation penalty: any stat below safetyPts at month-end
      const hd = headrooms(projStats);
      for (const s of active) {
        const shortfall = Math.max(0, safetyPts - hd[s]);
        if (shortfall > 0) score -= shortfall * 5.0;
      }

      cur = projStats;
    }

    // End-of-horizon ratio drift penalty
    const totalStats = active.reduce((sum, s) => sum + (cur[s] || 0), 0);
    if (totalStats > 0) {
      const finalRatios = ratioOf(cur);
      for (const s of active) {
        const deficit = Math.max(0, (ratio[s] || 0) - finalRatios[s]);
        if (deficit > 0) score -= deficit * totalStats * 0.01;
      }
    }

    return score;
  }

  // ── REAL-TIME INSTRUCTION ────────────────────────────────────────────────────
  function buildInstruction(currentE, snap, stats, currentMonth, settings) {
    if (!currentMonth) return null;
    const { topTwo, splits, buffs, GYM_FOR } = currentMonth;
    if (!topTwo || !topTwo.length) return null;

    const primary   = topTwo[0]?.stat;
    const secondary = topTwo[1]?.stat || null;
    if (!primary) return null;

    // Today's gains from snapshot
    const gains = {};
    STATS.forEach(s => { gains[s] = snap ? Math.max(0, (stats[s]||0) - (snap[s]||0)) : 0; });

    // Which stat to train now: compare today's gain progress to planned split ratio
    const totalGains = (gains[primary]||0) + (gains[secondary]||0);
    const primaryGainFrac  = totalGains > 0 ? (gains[primary]||0) / totalGains : 0;
    const totalSplit = (splits[primary]||0) + (splits[secondary]||0);
    const primarySplitFrac = totalSplit > 0 ? (splits[primary]||0) / totalSplit : 0.6;
    const trainStat = (primaryGainFrac <= primarySplitFrac || totalGains === 0)
      ? primary : (secondary || primary);

    const gymKey    = GYM_FOR[trainStat];
    const ePerTrain = GYM_ENERGY[gymKey];
    const trains    = Math.floor(currentE / ePerTrain);
    const energyUsed = trains * ePerTrain;
    const leftover  = currentE - energyUsed;

    // Daily target gains for progress display
    const dailyTargetGains = {};
    const dailyE = computeDailyEnergy(settings);
    for (const stat of [primary, secondary]) {
      if (!stat || (settings.ignoredStats||{})[stat]) continue;
      const gk = GYM_FOR[stat];
      const monthlyE = splits[stat] || 0;
      const totalMonthE = (splits[primary]||0) + (splits[secondary]||0);
      const dailyShare = totalMonthE > 0
        ? Math.round((monthlyE / totalMonthE) * dailyE)
        : Math.round(dailyE / 2);
      dailyTargetGains[stat] = projGain(stat, stats[stat]||1e6, buffs[stat]||0, gk, dailyShare);
    }

    // Compute estimated gain per single train for the recommended stat
    const estGainPerTrain = gainPerTrain(trainStat, stats[trainStat]||1e6, buffs[trainStat]||0, gymKey);

    return {
      trainStat, gymKey, gymName: GYM_NAME[gymKey], ePerTrain,
      trains, energyUsed, leftover, currentE,
      gains, primary, secondary, dailyTargetGains, GYM_FOR,
      estGainPerTrain,
    };
  }

  // ── FORMAT ───────────────────────────────────────────────────────────────────
  function fmt(n) {
    if (n == null) return '—';
    if (n >= 1e9) return (n/1e9).toFixed(3)+'B';
    if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(0)+'K';
    return String(Math.round(n));
  }

  // TCT (Torn City Time) = UTC. All daily resets happen at midnight UTC (≈ 8 pm EDT / 7 pm EST).
  function todayKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }

  function daysLeft() {
    const n = new Date();
    const daysInMonth = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
    return daysInMonth - n.getUTCDate();
  }

  // ── SNAPSHOT ─────────────────────────────────────────────────────────────────
  function updateSnap(stats) {
    const today = todayKey();
    const ex = (() => { try { return JSON.parse(Store.get(KEYS.SNAP)); } catch { return null; } })();
    if (!ex || ex.date !== today) {
      const snap = { date: today, ...stats };
      Store.set(KEYS.SNAP, JSON.stringify(snap));
      return snap;
    }
    return ex;
  }

  // ── DAILY ENERGY LOG ─────────────────────────────────────────────────────────
  // Stores up to 14 days of: { d, budgetE, startE, endE, spentE }
  // spentE = estimated E used for training = startE + budgetE - endE (clamped)
  function loadElog() {
    try { return JSON.parse(Store.get(KEYS.ELOG)) || []; } catch { return []; }
  }
  function saveElog(log) { Store.set(KEYS.ELOG, JSON.stringify(log.slice(-14))); }

  // Persist tracking state across page reloads so day-rollover detection works
  // even if the browser was closed before TCT midnight.
  function initEtrackState() {
    try {
      const s = JSON.parse(Store.get(KEYS.ETST));
      if (s && s.d) {
        MEM.lastTctDate = s.d;
        MEM.dayStartE   = s.startE ?? null;
        MEM.prevE       = s.prevE  ?? null;
      }
    } catch {}
  }

  // Called after every energy reading (init + 5-min interval).
  function updateEnergyTracking(currentE, settings) {
    if (currentE == null) return;
    const today = todayKey();

    if (MEM.lastTctDate === null) {
      // First reading ever — initialise without recording a partial day
      MEM.lastTctDate = today;
      MEM.dayStartE   = currentE;
      MEM.prevE       = currentE;
      Store.set(KEYS.ETST, JSON.stringify({ d: today, startE: currentE, prevE: currentE }));
      return;
    }

    if (today !== MEM.lastTctDate) {
      // TCT day rolled over — record the completed day
      const budgetE = computeDailyEnergy(settings);
      const startE  = MEM.dayStartE ?? 0;
      const endE    = MEM.prevE ?? currentE;
      // Energy used for training = what you had + what you earned - what's left
      const spentE  = Math.max(0, Math.min(startE + budgetE - endE, startE + budgetE));
      const log     = loadElog();
      const idx     = log.findIndex(e => e.d === MEM.lastTctDate);
      const entry   = { d: MEM.lastTctDate, budgetE, startE, endE, spentE };
      if (idx >= 0) log[idx] = entry; else log.push(entry);
      saveElog(log);

      MEM.lastTctDate = today;
      MEM.dayStartE   = currentE;
    }

    MEM.prevE = currentE;
    Store.set(KEYS.ETST, JSON.stringify({ d: MEM.lastTctDate, startE: MEM.dayStartE, prevE: MEM.prevE }));
  }

  // ── API ──────────────────────────────────────────────────────────────────────

  function loadSettings() {
    try {
      const saved = JSON.parse(Store.get(KEYS.SET)) || {};
      // Deep merge — nested objects get merged, not replaced
      const merged = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS)) {
        if (saved[key] !== undefined) {
          if (typeof DEFAULTS[key] === 'object' && DEFAULTS[key] !== null && !Array.isArray(DEFAULTS[key])) {
            merged[key] = { ...DEFAULTS[key], ...saved[key] };
          } else {
            merged[key] = saved[key];
          }
        }
      }
      return merged;
    } catch { return { ...DEFAULTS }; }
  }
  function saveSettings(s) { Store.set(KEYS.SET, JSON.stringify(s)); }
  // Pre-populated schedule — overridden by anything saved in localStorage
  const DEFAULT_SCHEDULE = [
  {
    "month": "2026-04",
    "buffs": {
      "def": 14,
      "str": 14,
      "spd": 10,
      "dex": 10
    },
    "label": "Apr \u2014 DEF/STR"
  },
  {
    "month": "2026-05",
    "buffs": {
      "def": 10,
      "str": 10,
      "spd": 14,
      "dex": 14
    },
    "label": "May \u2014 SPD/DEX"
  },
  {
    "month": "2026-06",
    "buffs": {
      "def": 14,
      "str": 14,
      "spd": 10,
      "dex": 10
    },
    "label": "Jun \u2014 DEF/STR"
  },
  {
    "month": "2026-07",
    "buffs": {
      "def": 10,
      "str": 10,
      "spd": 14,
      "dex": 14
    },
    "label": "Jul \u2014 SPD/DEX"
  }
];

  function loadSchedule() {
    try {
      const saved = JSON.parse(Store.get(KEYS.ROT));
      return (saved && saved.length) ? saved : DEFAULT_SCHEDULE;
    } catch { return DEFAULT_SCHEDULE; }
  }
  function saveSchedule(s) { Store.set(KEYS.ROT, JSON.stringify(s)); }

  // ── CSS ──────────────────────────────────────────────────────────────────────
  const CSS = `
    #nc17 {
      position:fixed;top:10px;right:10px;width:300px;background:#12141c;
      border:2px solid #404460;border-radius:10px;z-index:99999;
      font-family:Georgia,serif;font-size:13px;color:#e8eaf8;
      box-shadow:0 8px 32px rgba(0,0,0,0.85);overflow:hidden;
    }
    #nc17 * { box-sizing:border-box; }
    #nc17-hdr {
      background:#1c1f2e;padding:11px 14px;border-bottom:2px solid #404460;
      display:flex;justify-content:space-between;align-items:center;
      cursor:grab;user-select:none;touch-action:none;
    }
    #nc17-body {
      max-height:calc(85vh - 80px);overflow-y:auto;touch-action:pan-y;
    }
    #nc17-title {
      font-size:11px;letter-spacing:2px;color:#b0bce0;font-weight:700;
      text-transform:uppercase;font-family:'Courier New',monospace;
    }
    #nc17-tabs { display:flex;gap:6px; }
    .nc17-tab {
      font-size:10px;font-family:'Courier New',monospace;padding:4px 9px;
      border:1px solid #505878;border-radius:4px;background:transparent;
      color:#8898c8;cursor:pointer;pointer-events:all;
    }
    .nc17-tab.on { background:#2a3260;color:#d0e0ff;border-color:#7080d0; }
    .nc17-sec { padding:14px 16px;border-bottom:1px solid #2a2d40; }
    .nc17-sec:last-child { border-bottom:none; }
    .nc17-lbl {
      font-size:9px;letter-spacing:2px;color:#8090b8;text-transform:uppercase;
      margin:0 0 12px 0;font-weight:700;font-family:'Courier New',monospace;display:block;
    }
    .nc17-crit {
      background:#3a1010;border:1px solid #cc3030;border-radius:5px;
      padding:10px 12px;margin-bottom:8px;font-size:12px;color:#ff9898;line-height:1.6;
    }
    .nc17-warn {
      background:#2e2008;border:1px solid #aa7010;border-radius:5px;
      padding:10px 12px;margin-bottom:8px;font-size:12px;color:#ffd870;line-height:1.6;
    }
    .nc17-cmd {
      background:#181c2e;border:2px solid #4a5090;border-radius:8px;padding:16px;
    }
    .nc17-cmd-stat { font-size:26px;font-weight:700;margin-bottom:4px; }
    .nc17-cmd-gym  { font-size:13px;color:#c0cce8;margin-bottom:12px;font-family:'Courier New',monospace; }
    .nc17-cmd-trains { font-size:22px;font-weight:700;font-family:'Courier New',monospace;margin-bottom:4px; }
    .nc17-cmd-detail { font-size:12px;color:#8090b8;font-family:'Courier New',monospace;line-height:2.0; }
    .nc17-cmd-div { border-top:1px solid #2a2d40;margin:12px 0; }
    .nc17-cmd-next { font-size:12px;margin-top:10px; }
    .nc17-prog-row { display:flex;align-items:center;gap:12px;margin-bottom:14px; }
    .nc17-prog-name { font-size:12px;width:68px; }
    .nc17-prog-track { flex:1;height:10px;background:#1e2130;border-radius:5px;overflow:hidden; }
    .nc17-prog-fill  { height:100%;border-radius:5px; }
    .nc17-prog-val   { font-size:11px;font-family:'Courier New',monospace;color:#c0cce8;width:48px;text-align:right; }
    .nc17-row {
      display:flex;justify-content:space-between;align-items:center;
      padding:10px 4px;border-bottom:1px solid #2a2d40;font-size:13px;
    }
    .nc17-row:last-child { border-bottom:none; }
    .nc17-row-key { color:#c0cce8; }
    .nc17-row-val { font-weight:700;font-size:14px;font-family:'Courier New',monospace; }
    .nc17-pills { display:flex;gap:8px;margin-bottom:14px; }
    .nc17-pill {
      flex:1;text-align:center;padding:8px;border-radius:6px;border:2px solid;
      font-size:13px;font-weight:700;font-family:'Courier New',monospace;
    }
    .nc17-pill.open   { border-color:#257535;background:#0d1a10;color:#60f090; }
    .nc17-pill.closed { border-color:#752525;background:#1e0d0d;color:#ff7878; }
    .nc17-pill-name { font-size:9px;letter-spacing:1px;opacity:0.8;margin-bottom:4px;font-weight:400; }
    .nc17-stat-row {
      display:flex;justify-content:space-between;
      padding:10px 4px;border-bottom:1px solid #2a2d40;font-size:13px;
    }
    .nc17-stat-row:last-child { border-bottom:none; }
    .nc17-plan-month { margin-bottom:20px; }
    .nc17-plan-hdr {
      font-size:11px;font-family:'Courier New',monospace;font-weight:700;
      color:#a0b0e0;margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid #2a2d40;
    }
    .nc17-plan-row {
      display:flex;justify-content:space-between;
      padding:9px 4px;border-bottom:1px solid #1e2130;font-size:12px;
    }
    .nc17-plan-row:last-child { border-bottom:none; }
    .nc17-plan-breach { font-size:11px;color:#ffd870;margin-top:6px;font-family:'Courier New',monospace; }
    .nc17-set-grp { margin-bottom:16px; }
    .nc17-set-lbl {
      font-size:9px;letter-spacing:2px;color:#8090b8;text-transform:uppercase;
      margin-bottom:8px;font-weight:700;font-family:'Courier New',monospace;
    }
    .nc17-radios { display:flex;gap:8px;flex-wrap:wrap;margin-top:2px; }
    .nc17-radio {
      padding:6px 10px;border:1px solid #505878;border-radius:4px;
      font-size:10px;font-family:'Courier New',monospace;color:#8898c8;
      cursor:pointer;background:transparent;pointer-events:all;
    }
    .nc17-radio.on { background:#2a3260;color:#d0e0ff;border-color:#7080d0; }
    .nc17-inp-row { display:flex;align-items:center;gap:8px;margin-bottom:12px; }
    .nc17-inp-lbl { font-size:12px;color:#b0bce0;width:110px; }
    .nc17-inp {
      flex:1;background:#1c1f2e;border:1px solid #505878;border-radius:4px;
      color:#e0e8ff;font-size:12px;font-family:'Courier New',monospace;
      padding:6px 9px;outline:none;
    }
    .nc17-inp:focus { border-color:#7080d0; }
    .nc17-inp-unit { font-size:11px;color:#6070a0; }
    .nc17-rot-row { display:flex;align-items:center;gap:6px;margin-bottom:10px; }
    .nc17-rot-month { font-size:10px;color:#8090b8;width:54px;font-family:'Courier New',monospace; }
    .nc17-rot-tag   { font-size:9px;color:#6070a0;width:24px;text-align:center;font-family:'Courier New',monospace; }
    .nc17-rot-inp {
      width:36px;background:#1c1f2e;border:1px solid #505878;border-radius:3px;
      color:#e0e8ff;font-size:11px;font-family:'Courier New',monospace;
      padding:4px;text-align:center;outline:none;
    }
    .nc17-rot-inp:focus { border-color:#7080d0; }
    .nc17-btn {
      font-size:11px;font-family:'Courier New',monospace;letter-spacing:1px;
      text-transform:uppercase;border:1px solid #5070c0;border-radius:5px;
      background:#1e2a50;color:#90b8ff;cursor:pointer;padding:9px 18px;pointer-events:all;
    }
    .nc17-btn:active { background:#253060; }
    #nc17-ftr {
      padding:8px 16px;font-size:10px;color:#7080a8;
      display:flex;justify-content:space-between;
      border-top:1px solid #2a2d40;cursor:pointer;
      font-family:'Courier New',monospace;letter-spacing:1px;
    }
    #nc17-ftr:active { color:#b0c0e0; }
  `;

  // ── RENDER ───────────────────────────────────────────────────────────────────
  function render() {
    // Always try to read current energy from DOM — it's live on the page
    const domEnergy = readEnergyFromDOM();
    if (domEnergy != null) MEM.energy = domEnergy;
    const { stats, energy, settings, schedule, snap } = MEM;
    let plan = [];
    try { if (stats && settings && schedule) plan = planHorizon(stats, schedule, settings); }
    catch(e) { console.error('[GymOpt] planHorizon error:', e); }
    MEM._planLength = plan.length;
    const curMonth = plan.find(m => m.isCurrent) || plan[0] || null;
    let instr = null;
    try { if (stats && curMonth) instr = buildInstruction(energy ?? 0, snap, stats, curMonth, settings); }
    catch(e) { console.error('[GymOpt] buildInstruction error:', e); }
    const open = gymOpen(stats || {def:0,str:0,spd:0,dex:0});
    const hd   = stats ? headrooms(stats) : null;

    if (!document.getElementById('nc17-css')) {
      const s = document.createElement('style');
      s.id = 'nc17-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    let panel = document.getElementById('nc17');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'nc17';
      document.body.appendChild(panel);
    }

    try {
      panel.innerHTML = buildHTML(stats, energy, settings, schedule, plan, curMonth, instr, open, hd);
    } catch(e) {
      panel.innerHTML = `<div style="padding:14px;color:#ff8080;font-family:'Courier New',monospace;font-size:11px;background:#12141c;border-radius:8px;">
        Render error: ${e.message}<br><br>Please report this.
      </div>`;
      console.error('[GymOpt] render error:', e);
    }
    try { bindEvents(panel, settings, schedule); } catch(e) { console.error('[GymOpt] bindEvents error:', e); }
    try { makeDraggable(panel.querySelector('#nc17-hdr'), panel); } catch {}
  }

  // ── HTML ─────────────────────────────────────────────────────────────────────
  function buildHTML(stats, energy, settings, schedule, plan, curMonth, instr, open, hd) {
    const col = MEM.collapsed, view = MEM.view;

    const hdr = `<div id="nc17-hdr">
      <span id="nc17-title">⚡ Gym Optimizer</span>
      <div id="nc17-tabs">
        <button class="nc17-tab ${view==='main'?'on':''}" data-view="main">Now</button>
        <button class="nc17-tab ${view==='plan'?'on':''}" data-view="plan">Plan</button>
        <button class="nc17-tab ${view==='setup'?'on':''}" data-view="setup">Setup</button>
      </div>
    </div>`;

    const ftr = `<div id="nc17-ftr">
      <span>NC17 v${SCRIPT_VERSION}${TEST_MODE ? ' · TEST' : ''}${energy != null ? ' · '+energy+'E' : ''}</span>
      <span>${col ? '▼ expand' : '▲ collapse'}</span>
    </div>`;

    if (col) return hdr + ftr;

    let body;
    if (!stats) {
      const errMsg = MEM.fetchError;
      const elapsed = MEM.fetchStarted ? Date.now() - MEM.fetchStarted : 0;
      const timedOut = elapsed > 8000;
      body = `<div class="nc17-sec" style="line-height:1.8;">
        ${errMsg
          ? `<div class="nc17-crit" style="font-size:11px;line-height:1.6;">${errMsg}</div>`
          : timedOut
            ? `<div class="nc17-warn" style="font-size:11px;line-height:1.6;">Fetch timed out. Open gym.php while on torn.com — not from a bookmark or external link. API key: ${API_KEY.slice(0,6)}...</div>`
            : `<span style="color:#8090b0;">⏳ Loading stats...</span>`
        }
      </div>`;
    } else if (view === 'setup') {
      body = setupHTML(settings, schedule);
    } else if (view === 'plan') {
      body = planViewHTML(plan, settings);
    } else {
      body = instrHTML(instr, curMonth, settings) + progressHTML(instr, stats) + energyTrackerHTML(settings) + gymStatusHTML(open, hd, settings) + statsHTML(stats);
    }

    return hdr + `<div id="nc17-body">${body}</div>` + ftr;
  }

  function instrHTML(instr, curMonth, settings) {
    if (!curMonth) return `<div class="nc17-sec"><div class="nc17-warn">No rotation for this month. Add it in Setup.<br><span style="font-size:10px;color:#505878;">Plan has ${MEM._planLength||0} months. Schedule has ${(MEM.schedule||[]).length} entries.</span></div></div>`;

    const buffStr = curMonth.topTwo.map(r => `${LABEL[r.stat]} +${curMonth.buffs[r.stat]}%`).join(' · ');

    if (!instr || instr.trains === 0) {
      const msg = instr
        ? `${instr.currentE}E now — need ${instr.ePerTrain}E/train in ${instr.gymName}`
        : `Debug: instr=null, energy=${MEM.energy}, curMonth=${curMonth?.month}, topTwo=${JSON.stringify(curMonth?.topTwo?.map(t=>t.stat))}`;
      return `<div class="nc17-sec">
        <div class="nc17-lbl">Right Now · ${curMonth.label}</div>
        <div class="nc17-cmd" style="color:#6070a8;font-size:12px;line-height:1.6;">${msg}</div>
      </div>`;
    }

    const other = instr.trainStat === instr.primary ? instr.secondary : instr.primary;
    const leftNote = instr.leftover > 0 ? `${instr.leftover}E leftover` : 'exact';

    return `<div class="nc17-sec">
      <div class="nc17-lbl">Right Now · ${curMonth.label}</div>
      <div class="nc17-cmd">
        <div class="nc17-cmd-stat" style="color:${COLOR[instr.trainStat]}">${LABEL[instr.trainStat]}</div>
        <div class="nc17-cmd-gym">${instr.gymName} · ${instr.ePerTrain}E per train</div>
        <div class="nc17-cmd-trains">${instr.trains} trains</div>
        <div class="nc17-cmd-detail">
          Uses ${instr.energyUsed}E of your ${instr.currentE}E · ${leftNote}<br>
          ${daysLeft()}d left in month<br>
          ~${fmt(instr.estGainPerTrain)} per train · happy ${MEM.happy != null ? fmt(MEM.happy) : 'est '+fmt(HAPPY_EST)}<br>
          ${(() => {
            const b = MEM.extraBonus;
            if (b === null) return '<span style="color:#6070a0">bonus: fetching…</span>';
            const src = MEM.extraBonusSource === 'manual' ? 'manual' : MEM.extraBonusSource === 'cache' ? 'cached' : 'api';
            return `<span style="color:#80d0a0">+${b}% pool/edu bonus</span> <span style="color:#505878">(${src})</span>`;
          })()}
        </div>
        ${other && !settings.ignoredStats?.[other] ? `
        <div class="nc17-cmd-div"></div>
        <div class="nc17-cmd-next" style="color:${COLOR[other]}aa">
          Then: ${LABEL[other]} when more E available
        </div>` : ''}
        <div class="nc17-cmd-div"></div>
        <div class="nc17-cmd-detail">${buffStr}</div>
        ${Object.keys(curMonth.correctiveTraining||{}).length ? `
        <div class="nc17-cmd-div"></div>
        <div class="nc17-cmd-detail" style="color:#ffd870;">${
          Object.entries(curMonth.correctiveTraining).map(([s, c]) =>
            `↗ ${LABEL[s]} corrective: ${c.trains} trains at ${GYM_NAME[c.gym]}`
          ).join('<br>')
        }</div>` : ''}
      </div>
    </div>`;
  }

  function progressHTML(instr, stats) {
    if (!instr || !MEM.snap) return '';
    const gains = instr.gains;
    const targets = instr.dailyTargetGains || {};
    const active = [instr.primary, instr.secondary].filter(s => s && !MEM.settings?.ignoredStats?.[s]);

    // Always show if we have targets, even if gains are zero yet
    const hasTargets = active.some(s => (targets[s]||0) > 0);
    if (!hasTargets) return '';

    return `<div class="nc17-sec">
      <div class="nc17-lbl">Daily Progress</div>
      ${active.map(s => {
        const gained  = gains[s] || 0;
        const target  = targets[s] || 0;
        const remaining = Math.max(0, target - gained);
        const pct = target > 0 ? Math.min(100, Math.round(gained / target * 100)) : 0;
        // Color: green ≥80%, yellow 40-79%, red <40%
        const barColor = pct >= 80 ? '#40d870' : pct >= 40 ? '#ffd060' : COLOR[s];
        const textColor = pct >= 80 ? '#40d870' : pct >= 40 ? '#ffd060' : '#ff8080';
        return `<div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
            <span style="color:${COLOR[s]}cc;font-weight:700;">${LABEL[s]}</span>
            <span style="font-family:'Courier New',monospace;color:${textColor};">+${fmt(gained)} / ${fmt(target)}</span>
          </div>
          <div style="height:10px;background:#1e2130;border-radius:5px;overflow:hidden;margin-bottom:4px;">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:5px;transition:width 0.4s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;font-family:'Courier New',monospace;color:#606880;">
            <span>${pct}% done</span>
            <span>${remaining > 0 ? fmt(remaining)+' remaining' : '✓ target hit'}</span>
          </div>
        </div>`;
      }).join('')}
      <div style="font-size:10px;color:#505878;font-family:'Courier New',monospace;">Targets = planned trains × est. gain/train · Resets midnight TCT</div>
    </div>`;
  }

  // ── DAILY ENERGY TRACKER HTML ────────────────────────────────────────────────
  function energyTrackerHTML(settings) {
    const regenE  = settings.baseRegen ?? 600;
    const refillE = 150;
    const xanE    = (settings.xanaxPerDay ?? 0) * 250;
    const budgetE = regenE + refillE + xanE;

    // Proportional bar for each energy source
    const bBar = (val, color) => {
      const pct = Math.round(val / budgetE * 100);
      return `<div style="flex:1;height:6px;background:#1e2130;border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>`;
    };

    const sources = [
      { label: 'Regen',  val: regenE,  color: '#60aaff' },
      { label: 'Refill', val: refillE, color: '#40e880' },
      ...(xanE > 0 ? [{ label: 'Xanax', val: xanE, color: '#ffcc40' }] : []),
    ];

    const budgetRows = sources.map(r => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
        <span style="font-size:11px;color:#8090b8;width:38px;">${r.label}</span>
        ${bBar(r.val, r.color)}
        <span style="font-size:11px;font-family:'Courier New',monospace;color:#c0cce8;width:38px;text-align:right;">${r.val}E</span>
      </div>`).join('');

    const log   = loadElog();
    const last7 = log.slice(-7);

    let avgSection = '';
    if (last7.length >= 2) {
      const avgSpent = Math.round(last7.reduce((s, e) => s + (e.spentE ?? 0), 0) / last7.length);
      const avgPct   = Math.round(avgSpent / budgetE * 100);
      const avgColor = avgPct >= 90 ? '#40d870' : avgPct >= 70 ? '#ffd060' : '#ff8080';
      avgSection = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #2a2d40;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px;">
          <span style="color:#8090b8;">7-day avg spent</span>
          <span style="color:${avgColor};font-family:'Courier New',monospace;font-weight:700;">${avgSpent}E <span style="font-size:10px;font-weight:400;">(${avgPct}%)</span></span>
        </div>
        ${last7.map(e => {
          const pct = Math.round((e.spentE ?? 0) / Math.max(1, e.budgetE) * 100);
          const c   = pct >= 90 ? '#40d870' : pct >= 70 ? '#ffd060' : '#ff8080';
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <span style="font-size:9px;color:#606880;font-family:'Courier New',monospace;width:38px;">${e.d.slice(5)}</span>
            <div style="flex:1;height:5px;background:#1e2130;border-radius:3px;overflow:hidden;">
              <div style="width:${Math.min(100,pct)}%;height:100%;background:${c};border-radius:3px;"></div>
            </div>
            <span style="font-size:9px;color:${c};font-family:'Courier New',monospace;width:32px;text-align:right;">${e.spentE ?? 0}E</span>
          </div>`;
        }).join('')}
      </div>`;
    }

    return `<div class="nc17-sec">
      <div class="nc17-lbl">Daily Energy · ${budgetE}E / day</div>
      ${budgetRows}
      <div style="display:flex;justify-content:space-between;font-size:11px;font-family:'Courier New',monospace;color:#606880;margin-top:2px;">
        <span>Total budget</span>
        <span style="color:#a0b0d0;">${budgetE}E / day</span>
      </div>
      ${avgSection}
      <div style="font-size:10px;color:#505878;font-family:'Courier New',monospace;margin-top:8px;">Resets midnight TCT (torn time · UTC)</div>
    </div>`;
  }

  function gymStatusHTML(open, hd, settings) {
    if (!hd) return '';
    const active = STATS.filter(s => !settings.ignoredStats?.[s]);
    return `<div class="nc17-sec">
      <div class="nc17-lbl">Gym Access</div>
      <div class="nc17-pills">
        <div class="nc17-pill ${open.fl?'open':'closed'}">
          <div class="nc17-pill-name">Frontline</div>${open.fl?'OPEN':'CLOSED'}
        </div>
        <div class="nc17-pill ${open.iso?'open':'closed'}">
          <div class="nc17-pill-name">Isoyama's</div>${open.iso?'OPEN':'CLOSED'}
        </div>
      </div>
      <div class="nc17-lbl">Headroom Before Gym Closes</div>
      ${active.map(s => {
        const raw = hd[s];
        const safe = Math.max(0, raw - settings.safetyM * 1e6);
        const gym = (s==='def'||s==='dex') ? 'Frontline' : "Isoyama's";
        return `<div class="nc17-row">
          <span class="nc17-row-key" style="color:${COLOR[s]}cc">${LABEL[s]}</span>
          <span style="font-size:10px;color:#505878;flex:1;padding:0 8px;">→ ${gym}</span>
          <span class="nc17-row-val" style="color:${safe<settings.safetyM*1e6?'#ffd870':'#e0e8f8'}">${fmt(raw)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  function statsHTML(stats) {
    return `<div class="nc17-sec">
      <div class="nc17-lbl">Current Stats</div>
      ${STATS.map(s=>`<div class="nc17-stat-row">
        <span style="color:${COLOR[s]}bb">${LABEL[s]}</span>
        <span style="color:#e0e8f8;font-weight:700;font-family:'Courier New',monospace;">${fmt(stats[s])}</span>
      </div>`).join('')}
    </div>`;
  }

  function planViewHTML(plan, settings) {
    if (!plan.length) return `<div class="nc17-sec"><div class="nc17-warn">No rotation data. Add buff schedule in Setup.</div></div>`;

    return `<div class="nc17-sec">
      <div class="nc17-lbl">Multi-Month Plan</div>
      ${plan.map((m, mi) => {
        const { splits, GYM_FOR: GF, peakStats, forcedTraining, forcedReasons, breaches, buffs, weights, feasibility, correctiveTraining } = m;

        // Peak stat rows — sorted by weight (highest first = what optimizer prioritizes)
        const sortedPeak = [...peakStats].sort((a,b) => (weights[b]||0) - (weights[a]||0));
        const prevFeasibility = mi > 0 ? (plan[mi-1].feasibility||{}) : {};
        const peakRows = sortedPeak.map((s, i) => {
          const e = splits[s]||0;
          const gk = GF[s];
          const trains = Math.floor(e / GYM_ENERGY[gk]);
          const isTop = i === 0;
          const prevFeas = prevFeasibility[s];
          const feasNote = prevFeas && !prevFeas.ok
            ? ` <span style="color:#ff8080;font-size:10px;font-weight:400;">(~${prevFeas.pct}% achievable)</span>`
            : '';
          return `<div class="nc17-plan-row">
            <span style="color:${COLOR[s]};font-weight:700;">${LABEL[s]}</span>
            <span style="color:#7080a8;font-size:11px;font-family:'Courier New',monospace;">${GYM_NAME[gk]} +${buffs[s]||0}%${isTop ? ' ★' : ''}</span>
            <span style="color:#c0cce8;font-family:'Courier New',monospace;font-weight:700;">${trains} trains${feasNote}</span>
          </div>`;
        }).join('');

        // Forced rows
        const forcedStats = Object.keys(forcedTraining||{}).filter(s => (forcedTraining[s]||0) > 0);
        const forcedRows = forcedStats.map(s => {
          const e = forcedTraining[s]||0;
          const gk = GF[s];
          const trains = Math.ceil(e / GYM_ENERGY[gk]);
          return `<div class="nc17-plan-row" style="opacity:0.8;">
            <span style="color:${COLOR[s]}99">${LABEL[s]}</span>
            <span style="color:#6a5020;font-size:11px;font-family:'Courier New',monospace;">${GYM_NAME[gk]} +${buffs[s]||0}% ⚠ min</span>
            <span style="color:#aa8030;font-family:'Courier New',monospace;">${trains} trains</span>
          </div>`;
        }).join('');

        // Corrective rows — amber, ratio-deficit catch-up training
        const corrStats = Object.keys(correctiveTraining||{}).filter(s => correctiveTraining[s]);
        const correctiveRows = corrStats.map(s => {
          const c  = correctiveTraining[s];
          const gk = c.gym;
          return `<div class="nc17-plan-row" style="background:#1a1500;border-radius:3px;margin-top:2px;">
            <span style="color:#ffd870;font-weight:700;">${LABEL[s]}</span>
            <span style="color:#c8a040;font-size:11px;font-family:'Courier New',monospace;">corrective · ${GYM_NAME[gk]}</span>
            <span style="color:#ffd060;font-family:'Courier New',monospace;font-weight:700;">${c.trains} trains</span>
          </div>
          <div style="font-size:10px;color:#aa8030;padding:2px 4px 4px;font-family:'Courier New',monospace;">↳ ${c.reason}</div>`;
        }).join('');

        // Feasibility rows — how much of next month's target this month's plan enables
        const feasRows = Object.entries(feasibility||{}).map(([ns, f]) => {
          const color = f.pct >= 80 ? '#40d870' : f.pct >= 50 ? '#ffd060' : '#ff8080';
          return `<div style="font-size:11px;font-family:'Courier New',monospace;color:${color};margin-top:5px;">
            → ${LABEL[ns]} headroom for next month: ${f.pct}%${f.ok ? ' ✓' : ` (${fmt(f.available)} of ${fmt(f.needed)} needed)`}
          </div>`;
        }).join('');

        return `<div class="nc17-plan-month">
          <div class="nc17-plan-hdr">${m.label}${m.isCurrent?' ← now':''} · ${m.days}d · peak +${m.maxBuff}%</div>
          ${peakRows}
          ${forcedRows}
          ${correctiveRows}
          ${feasRows}
          ${forcedReasons.length ? `<div class="nc17-plan-breach" style="color:#aa8030;margin-top:5px;">↳ ${forcedReasons.join(' | ')}</div>` : ''}
          ${breaches.length ? `<div class="nc17-plan-breach" style="margin-top:5px;">⚠ ${breaches.map(b=>`${LABEL[b.stat]} → ${b.gym}: ${b.room === 0 ? '≈0M' : fmt(b.room)} left`).join(', ')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── SETUP HTML ───────────────────────────────────────────────────────────────
  function setupHTML(settings, schedule) {
    const gymOpts = [
      {v:'isoyamas',l:"Isoyama's (DEF 8×)"},{v:'gym3000',l:'Gym 3000 (STR 8×)'},
      {v:'totalrebound',l:'Total Rebound (SPD 8×)'},{v:'elites',l:'Elites (DEX 8×)'},
      {v:'frontline',l:'Frontline (STR+SPD 7.5×)'},{v:'balboas',l:"Balboa's (DEF+DEX 7.5×)"},
    ];
    const now = new Date();
    const months = Array.from({length:6},(_,i)=>{
      const d = new Date(now.getFullYear(),now.getMonth()+i,1);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    });
    const rotRows = months.map(m => {
      const ex = schedule.find(r=>r.month===m);
      const b = ex?.buffs||{def:0,str:0,spd:0,dex:0};
      return `<div class="nc17-rot-row" data-month="${m}">
        <span class="nc17-rot-month">${m}</span>
        <span class="nc17-rot-tag" style="color:${COLOR.def}">DEF</span>
        <input class="nc17-rot-inp" data-field="def" value="${b.def}" type="number" min="0" max="30">
        <span class="nc17-rot-tag" style="color:${COLOR.str}">STR</span>
        <input class="nc17-rot-inp" data-field="str" value="${b.str}" type="number" min="0" max="30">
        <span class="nc17-rot-tag" style="color:${COLOR.spd}">SPD</span>
        <input class="nc17-rot-inp" data-field="spd" value="${b.spd}" type="number" min="0" max="30">
        <span class="nc17-rot-tag" style="color:${COLOR.dex}">DEX</span>
        <input class="nc17-rot-inp" data-field="dex" value="${b.dex}" type="number" min="0" max="30">
      </div>`;
    }).join('');

    return `
      <div class="nc17-sec">
        <div class="nc17-set-grp">
          <div class="nc17-set-lbl">Active Stats</div>
          <div class="nc17-radios">${STATS.map(s=>{
            const off=settings.ignoredStats?.[s];
            return `<div class="nc17-radio ${off?'':'on'}" data-set="ignoredStats.${s}"
              style="color:${off?'#505878':COLOR[s]+'cc'};border-color:${off?'#303050':COLOR[s]+'55'}">
              ${LABEL[s]} ${off?'✗':'✓'}</div>`;
          }).join('')}</div>
        </div>
        <div class="nc17-set-grp">
          <div class="nc17-set-lbl">Primary Gym (8× dot)</div>
          <div class="nc17-radios">${gymOpts.slice(0,4).map(g=>`
            <div class="nc17-radio ${settings.primaryGym===g.v?'on':''}" data-set="primaryGym" data-val="${g.v}">${g.l}</div>`).join('')}
          </div>
        </div>
        <div class="nc17-set-grp">
          <div class="nc17-set-lbl">Secondary Gym (7.5× dot)</div>
          <div class="nc17-radios">${gymOpts.map(g=>`
            <div class="nc17-radio ${settings.secondaryGym===g.v?'on':''}" data-set="secondaryGym" data-val="${g.v}">${g.l}</div>`).join('')}
          </div>
        </div>
        <div class="nc17-set-grp">
          <div class="nc17-set-lbl">Training Params</div>
          <div class="nc17-inp-row">
            <span class="nc17-inp-lbl">Base Regen</span>
            <input class="nc17-inp" data-set="baseRegen" value="${settings.baseRegen ?? 600}" type="number" min="0" max="2000" step="10">
            <span class="nc17-inp-unit">E/day</span>
          </div>
          <div class="nc17-inp-row">
            <span class="nc17-inp-lbl">Xanax / day</span>
            <input class="nc17-inp" data-set="xanaxPerDay" value="${settings.xanaxPerDay ?? 0}" type="number" min="0" max="20" step="0.1">
            <span class="nc17-inp-unit">× 250E</span>
          </div>
          <div style="font-size:10px;color:#6070a0;margin-bottom:12px;font-family:'Courier New',monospace;">
            +150E pts refill (fixed) · Budget: <span style="color:#a0d0ff;font-weight:700;">${computeDailyEnergy(settings)}E/day</span>
          </div>
          <div class="nc17-inp-row">
            <span class="nc17-inp-lbl">Safety Buffer</span>
            <input class="nc17-inp" data-set="safetyM" value="${settings.safetyM}" type="number" min="1" max="200">
            <span class="nc17-inp-unit">M</span>
          </div>
          <div class="nc17-inp-row">
            <span class="nc17-inp-lbl">Bonus fallback</span>
            <input class="nc17-inp" data-set="extraBonusPct" value="${settings.extraBonusPct ?? 4}" type="number" min="0" max="20" step="0.5">
            <span class="nc17-inp-unit">% if API fails</span>
          </div>
          <div style="font-size:10px;color:#6070a0;margin-top:4px;font-family:'Courier New',monospace;">Pool+edu bonus auto-detected via API. This % is only used if the fetch fails. Clear cached value by reloading after midnight.</div>
        </div>
        <div class="nc17-set-grp">
          <div class="nc17-set-lbl">Stat Ratio Targets (%)</div>
          <div style="font-size:10px;color:#6070a0;margin-bottom:8px;font-family:'Courier New',monospace;">Used to weight STR vs SPD when both are peak. DEX ignored.</div>
          ${['def','str','spd'].map(s => `
          <div class="nc17-inp-row">
            <span class="nc17-inp-lbl" style="color:${COLOR[s]}cc">${LABEL[s]}</span>
            <input class="nc17-inp" data-set="ratioTargets.${s}" value="${settings.ratioTargets?.[s] ?? DEFAULTS.ratioTargets[s]}" type="number" min="0" max="100" step="0.5">
            <span class="nc17-inp-unit">%</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="nc17-sec">
        <div class="nc17-set-lbl">Faction Buff Rotation (%)</div>
        <div id="nc17-rot">${rotRows}</div>
        <div style="margin-top:12px;"><button class="nc17-btn" id="nc17-save">Save All</button></div>
      </div>`;
  }

  // ── EVENTS ───────────────────────────────────────────────────────────────────
  function bindEvents(panel, settings, schedule) {
    panel.querySelectorAll('.nc17-tab').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); MEM.view = btn.dataset.view; render(); });
    });

    const ftr = panel.querySelector('#nc17-ftr');
    if (ftr) ftr.addEventListener('click', () => {
      MEM.collapsed = !MEM.collapsed;
      Store.set(KEYS.COL, MEM.collapsed ? '1' : '0');
      render();
    });

    panel.querySelectorAll('.nc17-radio[data-set]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const key = el.dataset.set;
        if (key.startsWith('ignoredStats.')) {
          const s = key.split('.')[1];
          if (!MEM.settings.ignoredStats) MEM.settings.ignoredStats = {};
          MEM.settings.ignoredStats[s] = !MEM.settings.ignoredStats[s];
        } else {
          MEM.settings[key] = el.dataset.val;
        }
        saveSettings(MEM.settings);
        render();
      });
    });

    const saveBtn = panel.querySelector('#nc17-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', e => {
        e.stopPropagation();
        panel.querySelectorAll('.nc17-inp[data-set]').forEach(inp => {
          const key = inp.dataset.set;
          const val = parseFloat(inp.value);
          if (key.includes('.')) {
            const [parent, child] = key.split('.');
            if (!MEM.settings[parent]) MEM.settings[parent] = {};
            MEM.settings[parent][child] = val;
          } else {
            MEM.settings[key] = val;
          }
        });
        const newSched = [];
        panel.querySelectorAll('.nc17-rot-row[data-month]').forEach(row => {
          const month = row.dataset.month, buffs = {};
          row.querySelectorAll('.nc17-rot-inp').forEach(inp => { buffs[inp.dataset.field] = parseFloat(inp.value)||0; });
          if (Object.values(buffs).some(v=>v>0)) {
            const ex = MEM.schedule.find(r=>r.month===month);
            newSched.push({ month, buffs, label: ex?.label || month });
          }
        });
        saveSettings(MEM.settings);
        saveSchedule(newSched);
        MEM.schedule = newSched;
        saveBtn.textContent = '✓ Saved!';
        setTimeout(render, 600);
      });
    }
  }

  // ── DRAG ─────────────────────────────────────────────────────────────────────
  function makeDraggable(handle, panel) {
    if (!handle) return;
    let on=false, ox=0, oy=0;
    function isDraggable(t) { return t===handle || t.id==='nc17-title'; }
    function start(cx,cy,t) { if(!isDraggable(t))return; on=true; const r=panel.getBoundingClientRect(); ox=cx-r.left; oy=cy-r.top; panel.style.right='auto'; }
    function move(cx,cy) { if(!on)return; panel.style.left=Math.min(window.innerWidth-panel.offsetWidth,Math.max(0,cx-ox))+'px'; panel.style.top=Math.min(window.innerHeight-panel.offsetHeight,Math.max(0,cy-oy))+'px'; }
    function end() { on=false; }
    handle.addEventListener('mousedown', e=>start(e.clientX,e.clientY,e.target));
    document.addEventListener('mousemove', e=>move(e.clientX,e.clientY));
    document.addEventListener('mouseup', end);
    handle.addEventListener('touchstart', e=>start(e.touches[0].clientX,e.touches[0].clientY,e.target),{passive:true});
    document.addEventListener('touchmove', e=>{if(on){e.preventDefault();move(e.touches[0].clientX,e.touches[0].clientY);}},{passive:false});
    document.addEventListener('touchend', end);
  }

  // ── DOM ENERGY READ ──────────────────────────────────────────────────────────
  // Torn displays current energy in the sidebar on gym.php — read it directly.
  // No API call, no access level required.
  function readEnergyFromDOM() {
    try {
      // Torn's energy bar — try multiple selectors across game versions
      const selectors = [
        '[class*="energy"] [class*="current"]',
        '[class*="energy-bar"] [class*="value"]',
        'ul.status-icons li[class*="energy"] span',
        '[data-type="Energy"] [class*="current"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const val = parseInt(el.textContent.replace(/[^0-9]/g, ''), 10);
          if (!isNaN(val) && val >= 0) return val;
        }
      }
      // Fallback: scan all text for energy pattern like "142 / 150"
      const energyText = document.body.innerText.match(/Energy[^\d]*(\d+)\s*\/\s*(\d+)/i);
      if (energyText) return parseInt(energyText[1], 10);
    } catch {}
    return null;
  }

  // ── EXTRA TRAINING BONUS (pool + sports science) ─────────────────────────────
  async function fetchExtraBonus() {
    const TTL = 24 * 60 * 60 * 1000;

    // Use 24h cache — these values change at most when an education finishes or property is sold
    try {
      const cached = JSON.parse(Store.get(KEYS.XBONUS));
      if (cached && (Date.now() - cached.ts) < TTL) {
        MEM.extraBonus       = cached.pct;
        MEM.extraBonusSource = 'cache';
        return;
      }
    } catch {}

    let pct = null;
    try {
      const r = await fetch(`https://api.torn.com/user/?selections=education,properties&key=${API_KEY}`);
      const d = await r.json();
      if (!d.error) {
        let bonus = 0;

        // Sports Science education: +2% if course is in the completed list
        const completed = d.education_completed ?? [];
        if (completed.includes(SPORTS_SCIENCE_ID)) bonus += 2;

        // Swimming pool training upgrade: +2% if any owned/rented property carries the upgrade
        for (const prop of Object.values(d.properties ?? {})) {
          if ((prop.upgrades ?? {})[POOL_UPGRADE_KEY]) { bonus += 2; break; }
        }

        pct = bonus;
        Store.set(KEYS.XBONUS, JSON.stringify({ ts: Date.now(), pct }));
      }
    } catch {}

    if (pct !== null) {
      MEM.extraBonus       = pct;
      MEM.extraBonusSource = 'api';
    } else {
      // API failed — use manual fallback from settings
      MEM.extraBonus       = MEM.settings?.extraBonusPct ?? 0;
      MEM.extraBonusSource = 'manual';
    }
    render();
  }

  // ── BOOT ─────────────────────────────────────────────────────────────────────
  async function init() {
    if (!TEST_MODE && !location.pathname.startsWith('/gym.php')) return;
    await new Promise(r => setTimeout(r, 800));
    MEM.settings  = loadSettings();
    MEM.schedule  = loadSchedule();
    MEM.collapsed = Store.get(KEYS.COL) === '1';
    initEtrackState(); // restore day-tracking state from last session
    render();

    // Kick off bonus fetch in parallel — it renders independently when done
    fetchExtraBonus();

    // Fetch battlestats + bars (for real happiness and energy values)
    try {
      const r = await fetch(`https://api.torn.com/user/?selections=battlestats,bars&key=${API_KEY}`);
      const d = await r.json();
      if (!d.error) {
        MEM.stats  = { def: d.defense, str: d.strength, spd: d.speed, dex: d.dexterity };
        MEM.happy  = d.happy?.current ?? null;
        // Prefer DOM energy (real-time) but fall back to bars energy if DOM scrape fails
        const domE = readEnergyFromDOM();
        MEM.energy = domE ?? d.energy?.current ?? null;
        MEM.snap   = updateSnap(MEM.stats);
        updateEnergyTracking(MEM.energy, MEM.settings);
      } else {
        MEM.fetchError = `API error ${d.error.code}: ${d.error.error}`;
      }
    } catch(e) {
      MEM.fetchError = `Fetch failed: ${e.message}`;
    }
    render();

    if (MEM.stats) {
      render();

      // Refresh every 5 minutes
      setInterval(async () => {
        try {
          const r = await fetch(`https://api.torn.com/user/?selections=battlestats,bars&key=${API_KEY}`);
          const d = await r.json();
          if (!d.error) {
            MEM.stats  = { def: d.defense, str: d.strength, spd: d.speed, dex: d.dexterity };
            MEM.happy  = d.happy?.current ?? MEM.happy;
            const domE = readEnergyFromDOM();
            MEM.energy = domE ?? d.energy?.current ?? MEM.energy;
            updateEnergyTracking(MEM.energy, MEM.settings);
          }
        } catch {}
        render();
      }, 5 * 60 * 1000);
    }
  }

  init();
})();
