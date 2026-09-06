/**
 * PeriodicReportModal.tsx — Modale interattivo per la visualizzazione del Report Periodico
 * degli Allenamenti, analisi dei gruppi muscolari, dettaglio esercizi e resoconto delle note.
 */

import React, { useState, useMemo } from 'react';
import {
  X,
  BarChart3,
  Dumbbell,
  Layers,
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
  Activity,
} from 'lucide-react';
import type { MuscleGroup } from '../utils/exerciseClassifier';
import {
  type ReportPeriodType,
  type RawWorkoutSession,
  generatePeriodicReport,
  exportReportSummaryText,
} from '../utils/periodicReportEngine';

interface PeriodicReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  workouts: RawWorkoutSession[];
}

const MUSCLE_COLORS: Record<MuscleGroup, { bar: string; text: string; bg: string; border: string }> = {
  Petto: {
    bar: 'bg-orange-500',
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
  },
  Dorso: {
    bar: 'bg-cyan-500',
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
  },
  Gambe: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
  },
  Spalle: {
    bar: 'bg-purple-500',
    text: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
  },
  Braccia: {
    bar: 'bg-rose-500',
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
  },
  Addome: {
    bar: 'bg-amber-500',
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  Altro: {
    bar: 'bg-slate-500',
    text: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
  },
};

const PeriodicReportModal: React.FC<PeriodicReportModalProps> = ({
  isOpen,
  onClose,
  workouts,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriodType>('month');
  const [activeTab, setActiveTab] = useState<'muscles' | 'exercises' | 'notes'>('muscles');
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState('');
  const [selectedMuscleFilter, setSelectedMuscleFilter] = useState<string>('all');
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [expandedDossiers, setExpandedDossiers] = useState<Record<string, boolean>>({});

  // Calcolo del report analitico
  const report = useMemo(() => {
    return generatePeriodicReport(workouts, selectedPeriod);
  }, [workouts, selectedPeriod]);

  if (!isOpen) return null;

  const handleCopySummary = async () => {
    const text = exportReportSummaryText(report);
    try {
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

  // Filtro esercizi
  const filteredExercises = report.exercises.filter((ex) => {
    const matchesSearch =
      exerciseSearchQuery === '' ||
      ex.displayName.toLowerCase().includes(exerciseSearchQuery.toLowerCase());
    const matchesGroup =
      selectedMuscleFilter === 'all' || ex.muscleGroup === selectedMuscleFilter;
    return matchesSearch && matchesGroup;
  });

  // Filtro dossier note
  const filteredDossiers = report.notesDossiers.filter((dossier) => {
    const matchesSearch =
      exerciseSearchQuery === '' ||
      dossier.exerciseName.toLowerCase().includes(exerciseSearchQuery.toLowerCase()) ||
      dossier.chronologicalNotes.some((n) => n.text.toLowerCase().includes(exerciseSearchQuery.toLowerCase()));
    const matchesGroup =
      selectedMuscleFilter === 'all' || dossier.muscleGroup === selectedMuscleFilter;
    return matchesSearch && matchesGroup;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#0d0d0d] border border-brand-darkGrey/60 rounded-3xl shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">
        
        {/* ─── HEADER ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-white/10 bg-black/60 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-brand-orange/20 border border-brand-orange/40 text-brand-orange">
              <BarChart3 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  Report Periodico Allenamenti
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange border border-brand-orange/40">
                  <Sparkles size={11} /> Analytics
                </span>
              </div>
              <p className="text-xs text-brand-grey/80 mt-0.5">
                {report.period.label} • {report.totalWorkouts} {report.totalWorkouts === 1 ? 'sessione' : 'sessioni'} completate
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySummary}
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border border-brand-orange/40 bg-brand-orange/15 hover:bg-brand-orange/30 text-brand-orange active:scale-95 cursor-pointer shadow-sm"
              title="Copia riepilogo testuale per appunti o WhatsApp"
            >
              {copiedNotification ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
              <span className="hidden sm:inline">
                {copiedNotification ? 'Copiato!' : 'Copia Riepilogo'}
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          
          {/* SELETTORE PERIODO TEMPORALE */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-2xl bg-black/40 border border-white/5">
            <span className="text-xs font-black uppercase tracking-wider text-brand-grey/70 ml-2">
              Periodo di Analisi:
            </span>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {[
                { id: 'week', label: '7 Giorni' },
                { id: 'month', label: '30 Giorni' },
                { id: 'quarter', label: '3 Mesi' },
                { id: 'semester', label: '6 Mesi' },
                { id: 'year', label: '1 Anno' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPeriod(p.id as ReportPeriodType)}
                  type="button"
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    selectedPeriod === p.id
                      ? 'bg-brand-orange text-black font-black shadow-lg shadow-brand-orange/20 scale-105'
                      : 'bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/5'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* KPI CARDS GENERALI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-brand-orange/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Dumbbell size={16} className="text-brand-orange" />
                <span>Volume Totale</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {report.totalVolumeKg.toLocaleString('it-IT')}
                </span>
                <span className="text-xs font-bold text-brand-orange uppercase">kg</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                ≈ {(report.totalVolumeKg / 1000).toFixed(2)} tonnellate sollevate
              </p>
            </div>

            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Layers size={16} className="text-cyan-400" />
                <span>Serie Totali</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {report.totalSets}
                </span>
                <span className="text-xs font-bold text-cyan-400 uppercase">serie</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                Media {report.averageSetsPerWorkout} serie a sessione
              </p>
            </div>

            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Calendar size={16} className="text-emerald-400" />
                <span>Sessioni Svolte</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {report.totalWorkouts}
                </span>
                <span className="text-xs font-bold text-emerald-400 uppercase">workout</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                {report.totalReps.toLocaleString('it-IT')} ripetizioni totali
              </p>
            </div>

            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Activity size={16} className="text-rose-400" />
                <span>Media Seduta</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {report.averageVolumePerWorkout.toLocaleString('it-IT')}
                </span>
                <span className="text-xs font-bold text-rose-400 uppercase">kg/seduta</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                {report.notesDossiers.length} esercizi con note registrate
              </p>
            </div>
          </div>

          {/* TAB BAR DI NAVIGAZIONE INTERNA */}
          <div className="flex border-b border-white/10 gap-2 sm:gap-6">
            <button
              onClick={() => setActiveTab('muscles')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 ${
                activeTab === 'muscles'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              💪 Gruppi Muscolari
            </button>
            <button
              onClick={() => setActiveTab('exercises')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'exercises'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              <span>🏋️ Dettaglio Esercizi</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-white/80">
                {report.exercises.length}
              </span>
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
              <span>📋 Resoconto Note & Dossier</span>
              {report.notesDossiers.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-brand-orange/20 text-brand-orange font-bold">
                  {report.notesDossiers.length}
                </span>
              )}
            </button>
          </div>

          {/* ─── TAB 1: GRUPPI MUSCOLARI ───────────────────────────────────── */}
          {activeTab === 'muscles' && (
            <div className="space-y-6">
              {/* Barra di Distribuzione Proporzionale del Volume */}
              <div className="bg-brand-darkGrey/20 border border-white/10 rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-white">
                    Distribuzione Proporzionale del Volume (kg)
                  </span>
                  <span className="text-xs text-brand-grey/70">
                    Totale: {report.totalVolumeKg.toLocaleString('it-IT')} kg
                  </span>
                </div>

                {/* Progress bar multicolore */}
                <div className="w-full h-4 sm:h-5 bg-black/60 rounded-full overflow-hidden flex border border-white/5">
                  {report.muscleGroups
                    .filter((mg) => mg.volumePercent > 0)
                    .map((mg) => (
                      <div
                        key={mg.group}
                        style={{ width: `${mg.volumePercent}%` }}
                        className={`${MUSCLE_COLORS[mg.group].bar} transition-all duration-500 relative group`}
                        title={`${mg.group}: ${mg.volumePercent}% (${mg.volumeKg.toLocaleString('it-IT')} kg)`}
                      />
                    ))}
                </div>

                {/* Legenda rapida */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-xs">
                  {report.muscleGroups
                    .filter((mg) => mg.volumePercent > 0)
                    .map((mg) => (
                      <div key={mg.group} className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 rounded-full ${MUSCLE_COLORS[mg.group].bar}`} />
                        <span className="text-white/80 font-semibold">{mg.group}:</span>
                        <span className="font-bold text-white">{mg.volumePercent}%</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Schede Dettagliate per ciascun Gruppo Muscolare */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {report.muscleGroups
                  .filter((mg) => mg.volumeKg > 0 || mg.setsCount > 0)
                  .map((mg) => {
                    const theme = MUSCLE_COLORS[mg.group];
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
                              {mg.exerciseCount} {mg.exerciseCount === 1 ? 'esercizio' : 'esercizi'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="bg-black/30 rounded-xl p-2.5 border border-white/5">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Volume</span>
                              <span className="text-lg font-black text-white">
                                {mg.volumeKg.toLocaleString('it-IT')} <span className="text-xs text-brand-orange">kg</span>
                              </span>
                              <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                                {mg.volumePercent}% del totale
                              </span>
                            </div>

                            <div className="bg-black/30 rounded-xl p-2.5 border border-white/5">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Serie</span>
                              <span className="text-lg font-black text-white">
                                {mg.setsCount} <span className="text-xs text-cyan-400">set</span>
                              </span>
                              <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                                {mg.setsPercent}% del totale
                              </span>
                            </div>
                          </div>

                          {mg.topExercises.length > 0 && (
                            <div>
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block mb-1.5">
                                Principali movimenti:
                              </span>
                              <div className="space-y-1">
                                {mg.topExercises.map((topEx, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-white/5"
                                  >
                                    <span className="text-white/90 font-medium truncate max-w-[65%]">
                                      {topEx.displayName}
                                    </span>
                                    <span className="font-mono text-brand-grey/80 text-[11px]">
                                      {topEx.volumeKg.toLocaleString('it-IT')} kg ({topEx.sets}s)
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

          {/* ─── TAB 2: DETTAGLIO ESERCIZI ─────────────────────────────────── */}
          {activeTab === 'exercises' && (
            <div className="space-y-4">
              {/* Barra di ricerca e filtro gruppo muscolare */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-grey/50" />
                  <input
                    type="text"
                    placeholder="Cerca esercizio..."
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
                        ? 'bg-brand-orange text-black'
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
                          ? 'bg-brand-orange text-black'
                          : 'bg-white/5 hover:bg-white/10 text-brand-grey'
                      }`}
                    >
                      {group}
                    </button>
                  ))}
                </div>
              </div>

              {filteredExercises.length === 0 ? (
                <div className="text-center py-12 bg-brand-darkGrey/15 border border-dashed border-white/10 rounded-2xl">
                  <Dumbbell size={36} className="mx-auto text-brand-grey/30 mb-2" />
                  <p className="text-sm text-brand-grey font-bold">Nessun esercizio trovato per i filtri selezionati</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredExercises.map((ex) => {
                    const theme = MUSCLE_COLORS[ex.muscleGroup];
                    return (
                      <div
                        key={ex.canonicalId}
                        className="bg-brand-darkGrey/20 border border-white/10 hover:border-white/20 rounded-2xl p-3.5 sm:p-4 transition-all"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            <span
                              className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${theme.bg} ${theme.text} ${theme.border} mt-0.5`}
                            >
                              {ex.muscleGroup}
                            </span>
                            <div>
                              <h3 className="text-sm sm:text-base font-bold text-white leading-snug">
                                {ex.displayName}
                              </h3>
                              <p className="text-[11px] text-brand-grey/60 mt-0.5">
                                Eseguito in {ex.sessionsCount} {ex.sessionsCount === 1 ? 'sessione' : 'sessioni'} • {ex.totalSets} serie • {ex.totalReps} ripetizioni
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 sm:gap-6 self-end sm:self-auto">
                            {ex.maxWeightKg > 0 && (
                              <div className="text-right">
                                <span className="text-[10px] uppercase font-bold text-brand-grey/50 block">Carico Max</span>
                                <span className="text-xs font-black text-white font-mono">
                                  {ex.maxWeightKg} <span className="text-brand-orange text-[10px]">kg</span>
                                </span>
                              </div>
                            )}

                            <div className="text-right min-w-[80px]">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block">Volume</span>
                              <span className="text-sm font-black text-brand-orange font-mono">
                                {ex.totalVolumeKg.toLocaleString('it-IT')} <span className="text-[10px]">kg</span>
                              </span>
                            </div>

                            {/* Indicatore di Trend */}
                            <div className="text-right min-w-[65px]">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block">Trend</span>
                              {ex.trend === 'up' && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-400">
                                  <TrendingUp size={14} /> +{ex.percentChange}%
                                </span>
                              )}
                              {ex.trend === 'down' && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-rose-400">
                                  <TrendingDown size={14} /> {ex.percentChange}%
                                </span>
                              )}
                              {ex.trend === 'stable' && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-brand-grey/70">
                                  <Minus size={14} /> Stabile
                                </span>
                              )}
                              {ex.trend === 'new' && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-cyan-400 px-1.5 py-0.2 bg-cyan-400/10 rounded">
                                  Nuovo
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                    Il sistema ha analizzato tutte le note lasciate nelle sessioni del periodo, raggruppandole
                    sotto ciascun esercizio canonico per offrirti una sintesi descrittiva di sensazioni, progressioni di carico e affaticamento.
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
                    const theme = MUSCLE_COLORS[dossier.muscleGroup];
                    const isExpanded = Boolean(expandedDossiers[dossier.canonicalId]);

                    return (
                      <div
                        key={dossier.canonicalId}
                        className="bg-brand-darkGrey/25 border border-white/10 rounded-2xl p-4 sm:p-5 transition-all"
                      >
                        {/* Header Dossier */}
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
                              {dossier.totalNotes} {dossier.totalNotes === 1 ? 'osservazione' : 'osservazioni'}
                            </span>
                            {/* Temi dominanti badge */}
                            {dossier.dominantThemes.map((themeTag) => (
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

                        {/* Sintesi Scritta Descrittiva */}
                        <div className="bg-black/40 border border-white/5 rounded-xl p-3 sm:p-4 mb-3">
                          <p className="text-xs sm:text-sm text-white/90 leading-relaxed font-sans">
                            {dossier.writtenSynthesis}
                          </p>
                        </div>

                        {/* Pulsante per mostrare/nascondere la cronologia dettagliata note */}
                        <button
                          onClick={() => toggleDossierExpanded(dossier.canonicalId)}
                          type="button"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-orange hover:text-brand-lightOrange transition-colors cursor-pointer"
                        >
                          <span>{isExpanded ? 'Nascondi cronologia note' : `Mostra cronologia note (${dossier.chronologicalNotes.length})`}</span>
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>

                        {/* Lista cronologica note espandibile */}
                        {isExpanded && (
                          <div className="mt-3 space-y-2 pt-3 border-t border-white/5">
                            {dossier.chronologicalNotes.map((note, idx) => (
                              <div
                                key={idx}
                                className="bg-white/5 rounded-xl p-3 border border-white/5 text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between text-brand-grey/60 text-[10px]">
                                  <span className="font-bold text-white/70">{note.formattedDate}</span>
                                  <span>{note.workoutName}</span>
                                </div>
                                <p className="text-white text-xs leading-relaxed">{note.text}</p>
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
        <div className="p-4 border-t border-white/10 bg-black/70 flex items-center justify-between">
          <span className="text-xs text-brand-grey/60">
            Dati aggregati da {report.totalWorkouts} sessioni concluse
          </span>
          <button
            onClick={onClose}
            type="button"
            className="px-5 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md shadow-brand-orange/20"
          >
            Chiudi
          </button>
        </div>

      </div>
    </div>
  );
};

export default PeriodicReportModal;
