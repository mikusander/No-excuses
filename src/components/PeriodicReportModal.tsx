/**
 * PeriodicReportModal.tsx — Modale interattivo per la visualizzazione del Report Periodico
 * degli Allenamenti, con separazione rigorosa tra Livello Macro (Salute, Tempo, Hard Sets)
 * e Livello Micro (Performance specifica dell'esercizio, TUT, PR, progressione e trend).
 */

import React, { useState, useMemo, Component, type ErrorInfo, type ReactNode } from 'react';
import {
  X,
  BarChart3,
  Dumbbell,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  FileText,
  Copy,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertTriangle,
  Clock,
  Timer,
  Flame,
  Trophy,
  Zap,
} from 'lucide-react';
import type { MuscleGroup } from '../utils/exerciseClassifier';
import {
  type ReportPeriodType,
  type CustomDateRange,
  type RawWorkoutSession,
  generatePeriodicReport,
  getEmptyReport,
  exportReportSummaryText,
  parseSafeDate,
} from '../utils/periodicReportEngine';
import { ExerciseTrendChart } from './ExerciseTrendChart';

interface PeriodicReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  workouts: RawWorkoutSession[];
}

const MUSCLE_COLORS: Record<MuscleGroup, { bar: string; text: string; bg: string; border: string; hex: string }> = {
  Petto: {
    bar: 'bg-orange-500',
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    hex: '#f97316',
  },
  Dorso: {
    bar: 'bg-cyan-500',
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    hex: '#06b6d4',
  },
  Gambe: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    hex: '#10b981',
  },
  Spalle: {
    bar: 'bg-purple-500',
    text: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    hex: '#a855f7',
  },
  Braccia: {
    bar: 'bg-rose-500',
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    hex: '#f43f5e',
  },
  Addome: {
    bar: 'bg-amber-500',
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    hex: '#f59e0b',
  },
  Altro: {
    bar: 'bg-slate-500',
    text: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    hex: '#64748b',
  },
};

const getMuscleColorTheme = (group?: string | null) => {
  if (group && group in MUSCLE_COLORS) {
    return MUSCLE_COLORS[group as MuscleGroup];
  }
  return MUSCLE_COLORS.Altro;
};

const formatSafeNumber = (val: unknown): string => {
  const n = Number(val);
  return Number.isFinite(n) ? n.toLocaleString('it-IT') : '0';
};

const formatIsoDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface ErrorBoundaryProps {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class ReportErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error?.message || 'Errore imprevisto' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ReportErrorBoundary caught an error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.isOpen && !this.props.isOpen && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  handleClose = () => {
    this.setState({ hasError: false, errorMessage: null });
    this.props.onClose();
  };

  render() {
    if (!this.props.isOpen) {
      return null;
    }

    if (this.state.hasError) {
      return (
        <div
          onClick={this.handleClose}
          className="fixed inset-0 z-[100] h-[100dvh] w-screen flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-6"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#181818] border border-brand-orange/40 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl space-y-4"
          >
            <div className="p-3 bg-brand-orange/20 border border-brand-orange/40 rounded-2xl w-fit mx-auto text-brand-orange">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-lg sm:text-xl font-black text-white">
              Impossibile aprire il Report
            </h3>
            <p className="text-xs sm:text-sm text-brand-grey/80 leading-relaxed">
              Si è verificato un errore durante l'elaborazione dei dati delle sessioni. Nessun dato è andato perso.
            </p>
            {this.state.errorMessage && (
              <div className="p-2.5 rounded-xl bg-black/60 border border-white/10 text-[11px] text-red-300/90 font-mono text-left max-h-24 overflow-y-auto break-all select-all">
                {this.state.errorMessage}
              </div>
            )}
            <div className="pt-2">
              <button
                onClick={this.handleClose}
                type="button"
                className="w-full py-3 px-5 rounded-2xl bg-brand-orange text-black font-extrabold text-sm uppercase tracking-wider hover:bg-brand-lightOrange transition-colors cursor-pointer active:scale-95 shadow-lg shadow-brand-orange/20"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const PeriodicReportModalInner: React.FC<PeriodicReportModalProps> = ({
  isOpen,
  onClose,
  workouts,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriodType>('month');
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    return formatIsoDate(d);
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return formatIsoDate(new Date());
  });

  const [activeTab, setActiveTab] = useState<'exercises' | 'muscles' | 'notes'>('exercises');
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState('');
  const [selectedMuscleFilter, setSelectedMuscleFilter] = useState<string>('all');
  const [exerciseSortMode, setExerciseSortMode] = useState<'sets' | 'volume' | 'reps'>('sets');
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [expandedExerciseSessions, setExpandedExerciseSessions] = useState<Record<string, boolean>>({});
  const [expandedDossiers, setExpandedDossiers] = useState<Record<string, boolean>>({});

  const customRange = useMemo<CustomDateRange>(() => {
    return {
      startDate: customStartDate,
      endDate: customEndDate,
    };
  }, [customStartDate, customEndDate]);

  // Calcolo del report analitico con fallback sicuro
  const report = useMemo(() => {
    try {
      return generatePeriodicReport(
        workouts || [],
        selectedPeriod,
        selectedPeriod === 'custom' ? customRange : undefined
      );
    } catch (err) {
      console.error('Error generating periodic report:', err);
      return getEmptyReport(selectedPeriod, selectedPeriod === 'custom' ? customRange : undefined);
    }
  }, [workouts, selectedPeriod, customRange]);

  const handleApplyCustomPreset = (preset: 'this_month' | 'last_month' | 'last_14' | 'all_time') => {
    const now = new Date();
    if (preset === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setCustomStartDate(formatIsoDate(start));
      setCustomEndDate(formatIsoDate(now));
    } else if (preset === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setCustomStartDate(formatIsoDate(start));
      setCustomEndDate(formatIsoDate(end));
    } else if (preset === 'last_14') {
      const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      setCustomStartDate(formatIsoDate(start));
      setCustomEndDate(formatIsoDate(now));
    } else if (preset === 'all_time' && workouts && workouts.length > 0) {
      const timestamps = workouts
        .map((w) => parseSafeDate(w.executedAt)?.getTime() || 0)
        .filter((t) => t > 0);
      if (timestamps.length > 0) {
        const minDate = new Date(Math.min(...timestamps));
        const maxDate = new Date(Math.max(...timestamps));
        setCustomStartDate(formatIsoDate(minDate));
        setCustomEndDate(formatIsoDate(maxDate));
      }
    }
  };

  if (!isOpen) return null;

  const handleCopySummary = async () => {
    try {
      const text = exportReportSummaryText(report);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const toggleDossierExpanded = (canonicalId: string) => {
    setExpandedDossiers((prev) => ({
      ...prev,
      [canonicalId]: !prev[canonicalId],
    }));
  };

  const toggleExerciseSessionExpanded = (canonicalId: string) => {
    setExpandedExerciseSessions((prev) => ({
      ...prev,
      [canonicalId]: !prev[canonicalId],
    }));
  };

  // Filtro e ordinamento esercizi micro
  const sortedFilteredExercises = useMemo(() => {
    const list = (report?.exercises || []).filter((ex) => {
      if (!ex) return false;
      const displayName = String(ex.displayName || '');
      const matchesSearch =
        exerciseSearchQuery === '' ||
        displayName.toLowerCase().includes(exerciseSearchQuery.toLowerCase());
      const matchesGroup =
        selectedMuscleFilter === 'all' || ex.muscleGroup === selectedMuscleFilter;
      return matchesSearch && matchesGroup;
    });

    return list.sort((a, b) => {
      const aSets = Number(a?.totalHardSets) || 0;
      const bSets = Number(b?.totalHardSets) || 0;
      const aVol = Number(a?.totalVolumeKg) || 0;
      const bVol = Number(b?.totalVolumeKg) || 0;
      const aTut = Number(a?.totalDurationSeconds) || 0;
      const bTut = Number(b?.totalDurationSeconds) || 0;
      const aReps = Number(a?.totalReps) || 0;
      const bReps = Number(b?.totalReps) || 0;

      if (exerciseSortMode === 'sets') {
        if (bSets !== aSets) return bSets - aSets;
        return (bVol + bTut) - (aVol + aTut);
      }
      if (exerciseSortMode === 'volume') {
        if (bVol !== aVol) return bVol - aVol;
        if (bTut !== aTut) return bTut - aTut;
        return bSets - aSets;
      }
      if (bReps !== aReps) return bReps - aReps;
      return bSets - aSets;
    });
  }, [report?.exercises, exerciseSearchQuery, selectedMuscleFilter, exerciseSortMode]);

  // Filtro dossier note
  const filteredDossiers = (report?.notesDossiers || []).filter((dossier) => {
    if (!dossier) return false;
    const exName = String(dossier.exerciseName || '');
    const searchLower = exerciseSearchQuery.toLowerCase();
    const matchesSearch =
      exerciseSearchQuery === '' ||
      exName.toLowerCase().includes(searchLower) ||
      (dossier.chronologicalNotes || []).some((n) =>
        String(n?.text || '').toLowerCase().includes(searchLower)
      );
    const matchesGroup =
      selectedMuscleFilter === 'all' || dossier.muscleGroup === selectedMuscleFilter;
    return matchesSearch && matchesGroup;
  });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] h-[100dvh] w-screen flex flex-col items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 10px)',
        paddingRight: 'calc(env(safe-area-inset-right, 0px) + 10px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-4xl h-full max-h-full sm:max-h-[88vh] flex flex-col bg-[#141414] border border-white/15 rounded-3xl shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden min-h-0"
      >

        {/* ─── HEADER ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-3.5 sm:p-6 border-b border-white/10 bg-black/60 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-2xl bg-brand-orange/20 border border-brand-orange/40 text-brand-orange shrink-0">
              <BarChart3 size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-2xl font-black tracking-tight text-white truncate">
                  Report Statistiche
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange border border-brand-orange/40 shrink-0">
                  <Sparkles size={11} /> Macro & Micro
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-brand-grey/80 mt-0.5 truncate">
                {report.period?.label || 'Periodo'} • {report.macro.totalCompletedSessions} {report.macro.totalCompletedSessions === 1 ? 'sessione' : 'sessioni'} • {report.macro.formattedTotalDuration}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
            <button
              onClick={handleCopySummary}
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-bold transition-all border border-brand-orange/40 bg-brand-orange/15 hover:bg-brand-orange/30 text-brand-orange active:scale-95 cursor-pointer shadow-sm"
              title="Copia riepilogo analitico negli appunti"
            >
              {copiedNotification ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
              <span className="hidden md:inline">
                {copiedNotification ? 'Copiato!' : 'Copia Report'}
              </span>
            </button>

            <button
              onClick={onClose}
              type="button"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-brand-grey hover:text-white border border-white/10 transition-colors cursor-pointer"
              title="Chiudi report"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ─── CORPO SCORREVOLE ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6 space-y-6">

          {/* SELETTORE PERIODO TEMPORALE */}
          <div className="flex flex-col gap-3 p-2.5 sm:p-3.5 rounded-2xl bg-black/40 border border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <span className="text-xs font-black uppercase tracking-wider text-brand-grey/70 ml-1">
                Intervallo Temporale:
              </span>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {[
                  { id: 'week', label: '7 Giorni' },
                  { id: 'month', label: '30 Giorni' },
                  { id: 'quarter', label: '3 Mesi' },
                  { id: 'semester', label: '6 Mesi' },
                  { id: 'year', label: '1 Anno' },
                  { id: 'custom', label: 'Personalizzato' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPeriod(p.id as ReportPeriodType)}
                    type="button"
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      selectedPeriod === p.id
                        ? 'bg-brand-orange text-black font-black shadow-lg shadow-brand-orange/20 scale-105'
                        : 'bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/5'
                    }`}
                  >
                    {p.id === 'custom' && (
                      <Calendar size={13} className={selectedPeriod === 'custom' ? 'text-black' : 'text-brand-orange'} />
                    )}
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* SELEZIONE DATA PERSONALIZZATA */}
            {selectedPeriod === 'custom' && (
              <div className="mt-1 pt-3 border-t border-white/10 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <span className="text-brand-orange flex items-center gap-1">
                      <Calendar size={14} /> Date Selezionate:
                    </span>
                    <span className="text-brand-grey text-[11px] font-medium">
                      {report.period.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleApplyCustomPreset('this_month')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 transition-colors cursor-pointer active:scale-95"
                    >
                      Questo mese
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyCustomPreset('last_month')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 transition-colors cursor-pointer active:scale-95"
                    >
                      Mese scorso
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyCustomPreset('last_14')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 transition-colors cursor-pointer active:scale-95"
                    >
                      Ultimi 14 gg
                    </button>
                    {workouts && workouts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleApplyCustomPreset('all_time')}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange border border-brand-orange/30 transition-colors font-semibold cursor-pointer active:scale-95"
                      >
                        Tutto lo storico
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-brand-orange transition-colors">
                    <span className="text-xs font-black text-brand-orange uppercase tracking-wider w-8 shrink-0">
                      Dal:
                    </span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="bg-transparent text-white text-xs sm:text-sm font-bold focus:outline-none w-full [color-scheme:dark] cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-brand-orange transition-colors">
                    <span className="text-xs font-black text-brand-orange uppercase tracking-wider w-8 shrink-0">
                      Al:
                    </span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="bg-transparent text-white text-xs sm:text-sm font-bold focus:outline-none w-full [color-scheme:dark] cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── DASHBOARD GENERALE (LIVELLO MACRO - SALUTE, TEMPO & HARD SETS) ─ */}
          <div>
            <div className="flex items-center justify-between mb-2.5 px-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-brand-grey/80 flex items-center gap-1.5">
                <Zap size={13} className="text-brand-orange" />
                Dashboard Generale (Livello Macro)
              </span>
              <span className="text-[10px] text-brand-grey/50">
                Aderenza, tempo effettivo e carico sistemico
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* 1. Tempo Totale di Allenamento */}
              <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-brand-orange/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                  <Clock size={16} className="text-brand-orange" />
                  <span>Tempo Totale</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    {report.macro.formattedTotalDuration}
                  </span>
                </div>
                <p className="text-[11px] text-brand-grey/60 mt-1 truncate">
                  Tempo speso nelle sessioni
                </p>
              </div>

              {/* 2. Tempo Medio per Sessione */}
              <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
                <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                  <Timer size={16} className="text-cyan-400" />
                  <span>Media Sessione</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    {report.macro.formattedAverageDuration}
                  </span>
                </div>
                <p className="text-[11px] text-brand-grey/60 mt-1 truncate">
                  Efficienza temporale media
                </p>
              </div>

              {/* 3. Sessioni Completate */}
              <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
                <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                  <Calendar size={16} className="text-purple-400" />
                  <span>Sessioni Completate</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    {report.macro.totalCompletedSessions}
                  </span>
                  <span className="text-xs font-bold text-purple-400 uppercase">workout</span>
                </div>
                <p className="text-[11px] text-brand-grey/60 mt-1 truncate">
                  Frequenza: {report.macro.weeklyFrequency} / sett.
                </p>
              </div>

              {/* 4. Serie Allenanti Totali (Hard Sets) */}
              <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
                <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                  <Flame size={16} className="text-emerald-400" />
                  <span>Hard Sets Totali</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    {report.macro.totalHardSets}
                  </span>
                  <span className="text-xs font-bold text-emerald-400 uppercase">serie</span>
                </div>
                <p className="text-[11px] text-brand-grey/60 mt-1 truncate">
                  Media {report.macro.averageHardSetsPerSession} serie a seduta
                </p>
              </div>
            </div>
          </div>

          {/* TAB BAR DI NAVIGAZIONE INTERNA */}
          <div className="flex border-b border-white/10 gap-2 sm:gap-6">
            <button
              onClick={() => setActiveTab('exercises')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'exercises'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              <span>🏋️ Dettaglio Esercizi (Micro)</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-brand-orange/20 text-brand-orange font-bold">
                {(report.exercises || []).length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('muscles')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 ${
                activeTab === 'muscles'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              💪 Ripartizione Muscolare
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'notes'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              <span>📋 Resoconto Note</span>
              {(report.notesDossiers || []).length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-white/80">
                  {report.notesDossiers.length}
                </span>
              )}
            </button>
          </div>

          {/* ─── TAB 1: DETTAGLIO ESERCIZI (LIVELLO MICRO - PERFORMANCE SPECIFICA) */}
          {activeTab === 'exercises' && (
            <div className="space-y-4">
              {/* Barra di ricerca e filtro gruppo muscolare */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-grey/50" />
                    <input
                      type="text"
                      placeholder="Cerca esercizio (es. planche, panca, trazioni)..."
                      value={exerciseSearchQuery}
                      onChange={(e) => setExerciseSearchQuery(e.target.value)}
                      className="w-full bg-brand-darkGrey/30 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-brand-grey/40 focus:outline-none focus:border-brand-orange"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    <button
                      onClick={() => setSelectedMuscleFilter('all')}
                      type="button"
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                        selectedMuscleFilter === 'all'
                          ? 'bg-brand-orange text-black font-black'
                          : 'bg-white/5 hover:bg-white/10 text-brand-grey'
                      }`}
                    >
                      Tutti
                    </button>
                    {['Petto', 'Dorso', 'Gambe', 'Spalle', 'Braccia', 'Addome'].map((group) => (
                      <button
                        key={group}
                        onClick={() => setSelectedMuscleFilter(group)}
                        type="button"
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                          selectedMuscleFilter === group
                            ? 'bg-brand-orange text-black font-black'
                            : 'bg-white/5 hover:bg-white/10 text-brand-grey'
                        }`}
                      >
                        {group}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selettore ordinamento */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[11px] font-bold text-brand-grey/60 mr-1">Ordina per:</span>
                  <button
                    onClick={() => setExerciseSortMode('sets')}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      exerciseSortMode === 'sets'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-white/5 text-brand-grey hover:bg-white/10'
                    }`}
                  >
                    🔥 Serie Allenanti (Hard Sets)
                  </button>
                  <button
                    onClick={() => setExerciseSortMode('volume')}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      exerciseSortMode === 'volume'
                        ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/40'
                        : 'bg-white/5 text-brand-grey hover:bg-white/10'
                    }`}
                  >
                    🏋️ Carico (kg) / TUT
                  </button>
                  <button
                    onClick={() => setExerciseSortMode('reps')}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      exerciseSortMode === 'reps'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-white/5 text-brand-grey hover:bg-white/10'
                    }`}
                  >
                    🔢 Ripetizioni
                  </button>
                </div>
              </div>

              {sortedFilteredExercises.length === 0 ? (
                <div className="text-center py-12 bg-brand-darkGrey/15 border border-dashed border-white/10 rounded-2xl">
                  <Dumbbell size={36} className="mx-auto text-brand-grey/30 mb-2" />
                  <p className="text-sm text-brand-grey font-bold">Nessun esercizio trovato per i filtri selezionati</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedFilteredExercises.map((ex) => {
                    const theme = getMuscleColorTheme(ex.muscleGroup);
                    const isSessionsExpanded = Boolean(expandedExerciseSessions[ex.canonicalId]);

                    return (
                      <div
                        key={ex.canonicalId}
                        className="bg-brand-darkGrey/25 border border-white/10 hover:border-white/20 rounded-2xl p-4 sm:p-5 transition-all space-y-3.5"
                      >
                        {/* 1. Header Esercizio */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span
                              className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${theme.bg} ${theme.text} ${theme.border} mt-0.5 shrink-0`}
                            >
                              {ex.muscleGroup}
                            </span>

                            {ex.isIsometric ? (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border bg-cyan-500/15 text-cyan-300 border-cyan-500/30 mt-0.5 shrink-0">
                                Skill / Isometria
                              </span>
                            ) : (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border bg-orange-500/15 text-orange-300 border-orange-500/30 mt-0.5 shrink-0">
                                Dinamico
                              </span>
                            )}

                            <div className="min-w-0">
                              <h3 className="text-base sm:text-lg font-black text-white leading-snug break-words">
                                {ex.displayName}
                              </h3>
                              <p className="text-[11px] text-brand-grey/60 mt-0.5">
                                Svolto in {ex.sessionsCount} {ex.sessionsCount === 1 ? 'sessione' : 'sessioni'} • {ex.totalHardSets} serie allenanti (Hard Sets)
                              </p>
                            </div>
                          </div>

                          {/* Badge rapido PR in testata */}
                          <div className="self-start sm:self-center shrink-0">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-xs shadow-sm">
                              <Trophy size={14} className="text-amber-400" />
                              <span className="text-[10px] uppercase tracking-wider text-amber-400 font-black">PR:</span>
                              <span className="font-mono font-black">{ex.pr.formatted}</span>
                            </div>
                          </div>
                        </div>

                        {/* 2. Micro Metriche di Performance (Pills Grid) */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {/* Volume nel periodo */}
                          <div className="bg-black/40 rounded-xl p-3 border border-white/5 flex flex-col justify-between">
                            <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">
                              Volume nel Periodo
                            </span>
                            <div className="mt-1">
                              {ex.isIsometric ? (
                                <>
                                  <span className="text-base sm:text-lg font-black text-cyan-300 font-mono">
                                    {ex.totalDurationSeconds}s TUT
                                  </span>
                                  <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                                    ≈ {ex.formattedTUT} di tenuta totale
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="text-base sm:text-lg font-black text-white font-mono">
                                    {formatSafeNumber(ex.totalReps)} <span className="text-xs text-brand-grey">rip</span>
                                  </span>
                                  <span className="text-[10px] text-brand-grey/60 block mt-0.5 truncate">
                                    {ex.totalVolumeKg > 0
                                      ? `${formatSafeNumber(ex.totalVolumeKg)} kg (media ${ex.averageWeightKg} kg)`
                                      : 'Eseguito a corpo libero'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Personal Record & Scheda di Carico */}
                          <div className="bg-black/40 rounded-xl p-3 border border-white/5 flex flex-col justify-between">
                            <span className="text-[10px] uppercase font-bold text-amber-400/90 flex items-center gap-1">
                              <Trophy size={12} className="text-amber-400" /> Personal Record
                            </span>
                            <div className="mt-1">
                              <span className="text-base sm:text-lg font-black text-amber-300 font-mono">
                                {ex.pr.formatted}
                              </span>
                              <span className="text-[10px] text-brand-grey/60 block mt-0.5 truncate">
                                {ex.pr.details}
                              </span>
                            </div>
                          </div>

                          {/* Progressione Settimanale (% WoW) */}
                          <div className="bg-black/40 rounded-xl p-3 border border-white/5 flex flex-col justify-between">
                            <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">
                              Progressione
                            </span>
                            <div className="mt-1 flex items-center gap-2">
                              {ex.progression.direction === 'up' && (
                                <span className="inline-flex items-center gap-1 text-sm font-black text-emerald-400">
                                  <TrendingUp size={16} /> +{ex.progression.percentChange}%
                                </span>
                              )}
                              {ex.progression.direction === 'down' && (
                                <span className="inline-flex items-center gap-1 text-sm font-black text-rose-400">
                                  <TrendingDown size={16} /> {ex.progression.percentChange}%
                                </span>
                              )}
                              {ex.progression.direction === 'stable' && (
                                <span className="inline-flex items-center gap-1 text-sm font-black text-brand-grey/80">
                                  <Minus size={16} /> Stabile
                                </span>
                              )}
                              {ex.progression.direction === 'new' && (
                                <span className="inline-flex items-center text-xs font-black text-brand-orange uppercase">
                                  Nuovo nel periodo
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                              {ex.progression.comparisonLabel}
                            </span>
                          </div>
                        </div>

                        {/* 3. Trend Temporale (Curva di Progressione SVG a Zero Dipendenze) */}
                        <div className="pt-1">
                          <ExerciseTrendChart
                            historyPoints={ex.historyPoints}
                            isIsometric={ex.isIsometric}
                            metricLabel={ex.isIsometric ? 's' : ex.totalVolumeKg > 0 ? 'kg' : 'rip'}
                            accentColor={ex.isIsometric ? '#06b6d4' : ex.totalVolumeKg > 0 ? '#f97316' : '#10b981'}
                          />
                        </div>

                        {/* 4. Dettaglio Cronologico delle Sedute per questo Esercizio */}
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => toggleExerciseSessionExpanded(ex.canonicalId)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-brand-orange hover:text-brand-lightOrange transition-colors cursor-pointer"
                          >
                            <span>
                              {isSessionsExpanded
                                ? 'Nascondi storico sedute'
                                : `Visualizza storico sedute (${ex.historyPoints.length})`}
                            </span>
                            {isSessionsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>

                          {isSessionsExpanded && (
                            <div className="mt-2.5 space-y-1.5 pt-2 border-t border-white/5 animate-in fade-in duration-150">
                              {ex.historyPoints.map((pt, pIdx) => (
                                <div
                                  key={pIdx}
                                  className="flex items-center justify-between text-xs py-2 px-3 rounded-xl bg-black/40 border border-white/5"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-brand-grey text-[11px]">
                                      {pt.formattedDate}
                                    </span>
                                    <span className="text-white font-medium truncate max-w-[140px] sm:max-w-xs">
                                      {pt.workoutName}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 font-mono">
                                    <span className="text-brand-grey/70 text-[11px]">
                                      {pt.sets} {pt.sets === 1 ? 'serie' : 'serie'}
                                    </span>
                                    <span className="font-bold text-white bg-white/5 px-2 py-0.5 rounded-lg border border-white/5">
                                      {ex.isIsometric
                                        ? `${pt.metricValue}s TUT`
                                        : `${pt.reps} rip${pt.weightKg > 0 ? ` @ ${pt.weightKg}kg` : ''}`}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── TAB 2: RIPARTIZIONE MUSCOLARE ─────────────────────────────── */}
          {activeTab === 'muscles' && (
            <div className="space-y-6">
              {/* Barra di Distribuzione Hard Sets */}
              <div className="bg-brand-darkGrey/20 border border-white/10 rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-white">
                    Distribuzione Serie Allenanti (Hard Sets)
                  </span>
                  <span className="text-xs text-brand-grey/70">
                    Totale: {report.macro.totalHardSets} serie
                  </span>
                </div>

                <div className="w-full h-4 sm:h-5 bg-black/60 rounded-full overflow-hidden flex border border-white/5">
                  {(report.muscleGroups || [])
                    .filter((mg) => Number(mg.setsPercent) > 0)
                    .map((mg) => (
                      <div
                        key={mg.group}
                        style={{ width: `${mg.setsPercent}%` }}
                        className={`${getMuscleColorTheme(mg.group).bar} transition-all duration-500 relative group`}
                        title={`${mg.group}: ${mg.setsCount} serie (${mg.setsPercent}%)`}
                      />
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-xs">
                  {(report.muscleGroups || [])
                    .filter((mg) => Number(mg.setsPercent) > 0)
                    .map((mg) => (
                      <div key={mg.group} className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 rounded-full ${getMuscleColorTheme(mg.group).bar}`} />
                        <span className="text-white/80 font-semibold">{mg.group}:</span>
                        <span className="font-bold text-white">{mg.setsCount} serie ({mg.setsPercent}%)</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Schede Dettagliate per Gruppo Muscolare */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(report.muscleGroups || [])
                  .filter((mg) => Number(mg.setsCount) > 0 || Number(mg.volumeKg) > 0)
                  .map((mg) => {
                    const theme = getMuscleColorTheme(mg.group);
                    return (
                      <div
                        key={mg.group}
                        className={`bg-brand-darkGrey/25 border ${theme.border} rounded-2xl p-4 sm:p-5 relative overflow-hidden flex flex-col justify-between`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`text-base font-black tracking-wide ${theme.text}`}>
                              {mg.group}
                            </span>
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 font-bold text-white/90">
                              {Number(mg.exerciseCount) || 0} {Number(mg.exerciseCount) === 1 ? 'esercizio' : 'esercizi'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="bg-black/30 rounded-xl p-2.5 border border-white/5">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Serie Allenanti</span>
                              <span className="text-lg font-black text-white">
                                {Number(mg.setsCount) || 0} <span className="text-xs text-emerald-400">set</span>
                              </span>
                              <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                                {Number(mg.setsPercent) || 0}% del carico totale
                              </span>
                            </div>

                            <div className="bg-black/30 rounded-xl p-2.5 border border-white/5">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Tonnellaggio</span>
                              <span className="text-lg font-black text-white">
                                {formatSafeNumber(mg.volumeKg)} <span className="text-xs text-brand-orange">kg</span>
                              </span>
                              <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                                {Number(mg.volumePercent) || 0}% carico sovracc.
                              </span>
                            </div>
                          </div>

                          {(mg.topExercises || []).length > 0 && (
                            <div>
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block mb-1.5">
                                Movimenti principali nel gruppo:
                              </span>
                              <div className="space-y-1">
                                {(mg.topExercises || []).map((topEx, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-white/5"
                                  >
                                    <span className="text-white/90 font-medium truncate max-w-[60%]">
                                      {String(topEx.displayName || 'Esercizio')}
                                    </span>
                                    <span className="font-mono text-emerald-400 font-bold text-[11px]">
                                      {Number(topEx.sets) || 0} serie{Number(topEx.volumeKg) > 0 ? ` • ${formatSafeNumber(topEx.volumeKg)} kg` : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ─── TAB 3: RESOCONTO NOTE & OSSERVAZIONI ───────────────────────── */}
          {activeTab === 'notes' && (
            <div className="space-y-6">
              <div className="bg-brand-orange/10 border border-brand-orange/30 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
                <FileText size={22} className="text-brand-orange shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm sm:text-base font-black text-white">
                    Resoconto Sintetico delle Note per Esercizio
                  </h3>
                  <p className="text-xs text-white/80 mt-1 leading-relaxed">
                    Tutte le osservazioni lasciate nelle sessioni del periodo, raggruppate
                    sotto ciascun esercizio per offrirti una sintesi descrittiva di sensazioni, progressioni e affaticamento.
                  </p>
                </div>
              </div>

              {filteredDossiers.length === 0 ? (
                <div className="text-center py-12 bg-brand-darkGrey/15 border border-dashed border-white/10 rounded-2xl">
                  <FileText size={36} className="mx-auto text-brand-grey/30 mb-2" />
                  <p className="text-sm text-brand-grey font-bold">Nessuna nota o osservazione registrata nel periodo selezionato.</p>
                  <p className="text-xs text-brand-grey/50 mt-1">
                    Lascia note durante l'allenamento con l'icona note per vederle riassunte qui!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredDossiers.map((dossier) => {
                    const theme = getMuscleColorTheme(dossier.muscleGroup);
                    const isExpanded = Boolean(expandedDossiers[dossier.canonicalId]);

                    return (
                      <div
                        key={dossier.canonicalId}
                        className="bg-brand-darkGrey/25 border border-white/10 rounded-2xl p-4 sm:p-5 transition-all"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${theme.bg} ${theme.text} ${theme.border}`}>
                              {dossier.muscleGroup}
                            </span>
                            <h4 className="text-base font-black text-white">
                              {dossier.exerciseName}
                            </h4>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs text-brand-grey/70">
                              {Number(dossier.totalNotes) || 0} {Number(dossier.totalNotes) === 1 ? 'osservazione' : 'osservazioni'}
                            </span>
                            {(dossier.dominantThemes || []).map((themeTag) => (
                              <span
                                key={themeTag}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  themeTag === 'Progresso'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : themeTag === 'Fastidio'
                                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                    : themeTag === 'Fatica'
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                    : themeTag === 'Tecnica'
                                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                                    : 'bg-white/5 text-brand-grey border-white/10'
                                }`}
                              >
                                {themeTag === 'Progresso' && '↗️ '}
                                {themeTag === 'Fastidio' && '⚠️ '}
                                {themeTag === 'Fatica' && '🔥 '}
                                {themeTag === 'Tecnica' && '⚙️ '}
                                {themeTag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="bg-black/40 border border-white/5 rounded-xl p-3 sm:p-4 mb-3">
                          <p className="text-xs sm:text-sm text-white/90 leading-relaxed font-sans">
                            {dossier.writtenSynthesis}
                          </p>
                        </div>

                        <button
                          onClick={() => toggleDossierExpanded(dossier.canonicalId)}
                          type="button"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-orange hover:text-brand-lightOrange transition-colors cursor-pointer"
                        >
                          <span>{isExpanded ? 'Nascondi cronologia note' : `Mostra cronologia note (${(dossier.chronologicalNotes || []).length})`}</span>
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>

                        {isExpanded && (
                          <div className="mt-3 space-y-2 pt-3 border-t border-white/5">
                            {(dossier.chronologicalNotes || []).map((note, idx) => (
                              <div
                                key={idx}
                                className="bg-white/5 rounded-xl p-3 border border-white/5 text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between text-brand-grey/60 text-[10px]">
                                  <span className="font-bold text-white/70">{String(note.formattedDate || '')}</span>
                                  <span>{String(note.workoutName || 'Workout')}</span>
                                </div>
                                <p className="text-white text-xs leading-relaxed">{String(note.text || '')}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── FOOTER ──────────────────────────────────────────────────────── */}
        <div className="p-3.5 sm:p-4 border-t border-white/10 bg-black/80 flex items-center justify-between shrink-0">
          <span className="text-xs text-brand-grey/60 truncate mr-2">
            {report.macro.totalCompletedSessions} workout • {report.macro.formattedTotalDuration} • {report.macro.totalHardSets} hard sets
          </span>
          <button
            onClick={onClose}
            type="button"
            className="px-5 py-2.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md shadow-brand-orange/20 shrink-0 active:scale-95"
          >
            Chiudi
          </button>
        </div>

      </div>
    </div>
  );
};

const PeriodicReportModal: React.FC<PeriodicReportModalProps> = (props) => {
  if (!props.isOpen) return null;

  return (
    <ReportErrorBoundary onClose={props.onClose} isOpen={props.isOpen}>
      <PeriodicReportModalInner {...props} />
    </ReportErrorBoundary>
  );
};

export default PeriodicReportModal;
