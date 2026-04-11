/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccessor } from '../util/services.js';
import { Shield, ShieldCheck, Play, Square, ChevronDown, ChevronRight, FileCode, ExternalLink, Wrench, X, Eye, EyeOff, Zap, Clock, AlertTriangle, Info, Bug, Lock, History, Search, Layers, ShieldAlert, CheckCircle2, Loader2 } from 'lucide-react';
import { SentinelIssue, SentinelProgress, SentinelReviewSession, SentinelReviewResult, ReviewMode, SentinelSeverity } from '../../../../common/sentinelTypes.js';


// ---- Mode Config ----

const modeConfig: Record<ReviewMode, { label: string; desc: string; icon: typeof Shield }> = {
	deep: { label: 'Deep Review', desc: 'Multi-pass cross-file analysis', icon: Layers },
	quick: { label: 'Quick Scan', desc: 'Fast pass for obvious issues', icon: Zap },
	security: { label: 'Security Audit', desc: 'Penetration test inspired', icon: Lock },
	compliance: { label: 'Compliance', desc: 'Full compliance + security', icon: ShieldCheck },
};

const modeLabels: Record<ReviewMode, string> = {
	quick: 'Quick Scan',
	deep: 'Deep Review',
	security: 'Security Audit',
	compliance: 'Compliance',
};

// ---- Phase Config ----

const phases = ['diff', 'analysis', 'cross-file', 'security', 'rules', 'autofix', 'complete'] as const;
const phaseLabels: Record<string, string> = {
	diff: 'Extracting changes',
	analysis: 'Analyzing files',
	'cross-file': 'Cross-file analysis',
	security: 'Security audit',
	rules: 'Applying rules',
	autofix: 'Generating fixes',
	complete: 'Complete',
};

// ---- Severity Config ----

const severityBadgeClasses: Record<SentinelSeverity, string> = {
	blocker: 'sentinel-pill-blocker',
	critical: 'sentinel-pill-critical',
	warning: 'sentinel-pill-warning',
	info: 'sentinel-pill-info',
};

const severityIcons: Record<SentinelSeverity, React.ReactNode> = {
	blocker: <ShieldAlert size={10} />,
	critical: <Bug size={10} />,
	warning: <AlertTriangle size={10} />,
	info: <Info size={10} />,
};


// ---- Score Gauge ----

const ScoreGauge: React.FC<{ label: string; score: number }> = ({ label, score }) => {
	const radius = 25;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference - (score / 100) * circumference;

	let strokeColor = '#10b981'; // green
	if (score < 50) strokeColor = '#ef4444'; // red
	else if (score < 75) strokeColor = '#f59e0b'; // amber

	let valueColor = 'var(--void-fg-1)';
	if (score < 50) valueColor = '#ef4444';
	else if (score < 75) valueColor = '#f59e0b';
	else valueColor = '#10b981';

	return (
		<div className="sentinel-score-card">
			<div className="sentinel-score-gauge">
				<svg width="60" height="60" viewBox="0 0 60 60">
					<circle className="sentinel-score-gauge-bg" cx="30" cy="30" r={radius} />
					<circle
						className="sentinel-score-gauge-fill"
						cx="30" cy="30" r={radius}
						stroke={strokeColor}
						strokeDasharray={circumference}
						strokeDashoffset={offset}
					/>
				</svg>
				<span className="sentinel-score-value" style={{ color: valueColor }}>{score}</span>
			</div>
			<span className="sentinel-score-label">{label}</span>
		</div>
	);
};


// ---- Progress Stepper ----

const ProgressStepper: React.FC<{ progress: SentinelProgress }> = ({ progress }) => {
	const currentIdx = phases.indexOf(progress.phase as typeof phases[number]);
	const percentage = progress.totalFiles > 0
		? Math.round((progress.filesAnalyzed / progress.totalFiles) * 100)
		: 0;

	return (
		<div className="sentinel-progress-section">
			{/* Phase Dots */}
			<div className="sentinel-stepper">
				{phases.slice(0, -1).map((phase, i) => {
					const isCompleted = currentIdx > i;
					const isActive = currentIdx === i;
					return (
						<div className="sentinel-step" key={phase}>
							<div
								className={`sentinel-step-dot ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
								title={phaseLabels[phase]}
							/>
							{i < phases.length - 2 && (
								<div className={`sentinel-step-line ${isCompleted ? 'completed' : ''}`} />
							)}
						</div>
					);
				})}
			</div>

			{/* Progress Bar */}
			<div className="sentinel-progress-bar-track">
				<div
					className={`sentinel-progress-bar-fill ${progress.phase !== 'complete' ? 'analyzing' : ''}`}
					style={{ width: `${percentage}%` }}
				/>
			</div>

			{/* Info Row */}
			<div className="sentinel-progress-info">
				<span className="sentinel-progress-label">
					{phaseLabels[progress.phase] || progress.phase}
				</span>
				<span className="sentinel-progress-label">
					{progress.filesAnalyzed}/{progress.totalFiles} files · {progress.issuesFound} issues
				</span>
			</div>

			{progress.currentFile && (
				<div className="sentinel-progress-file" style={{ marginTop: '2px' }}>
					{progress.currentFile}
				</div>
			)}
		</div>
	);
};


// ---- Issue Card ----

const SentinelIssueCard: React.FC<{
	issue: SentinelIssue;
	onFix: (id: string) => void;
	onDismiss: (id: string) => void;
	onGoTo: (id: string) => void;
	onExplain: (id: string) => void;
}> = ({ issue, onFix, onDismiss, onGoTo, onExplain }) => {
	if (issue.dismissed) return null;

	return (
		<div className="sentinel-issue-card">
			<div className={`sentinel-issue-accent sentinel-issue-accent-${issue.severity}`} />
			<div className="sentinel-issue-body">
				{/* Badges */}
				<div className="sentinel-issue-badges">
					<span className={`sentinel-issue-severity-badge ${severityBadgeClasses[issue.severity]}`}>
						{severityIcons[issue.severity]} {issue.severity}
					</span>
					<span className="sentinel-issue-category-badge">
						{issue.category.replace(/_/g, ' ')}
					</span>
					<span className="sentinel-issue-confidence">
						{Math.round(issue.confidence * 100)}%
					</span>
					{issue.cweId && (
						<span className="sentinel-issue-cwe">{issue.cweId}</span>
					)}
				</div>

				{/* Message */}
				<p className="sentinel-issue-message">{issue.message}</p>

				{/* Suggestion */}
				{issue.suggestion && (
					<p className="sentinel-issue-suggestion">{issue.suggestion}</p>
				)}

				{/* Line info */}
				<p className="sentinel-issue-line-info">
					Lines {issue.startLine}–{issue.endLine}
				</p>

				{/* Actions */}
				<div className="sentinel-issue-actions">
					{issue.autofix && !issue.fixApplied && (
						<button className="sentinel-action-btn sentinel-action-fix" onClick={() => onFix(issue.id)}>
							<Wrench size={10} /> Fix
						</button>
					)}
					{issue.fixApplied && (
						<span className="sentinel-action-btn sentinel-action-fixed">
							<CheckCircle2 size={10} /> Fixed
						</span>
					)}
					<button className="sentinel-action-btn sentinel-action-goto" onClick={() => onGoTo(issue.id)}>
						<ExternalLink size={10} /> Go to
					</button>
					<button className="sentinel-action-btn sentinel-action-explain" onClick={() => onExplain(issue.id)}>
						<Eye size={10} /> Explain
					</button>
					<button className="sentinel-action-btn sentinel-action-dismiss" onClick={() => onDismiss(issue.id)}>
						<EyeOff size={10} /> Dismiss
					</button>
				</div>
			</div>
		</div>
	);
};


// ---- File Group ----

const SentinelFileGroup: React.FC<{
	filePath: string;
	issues: SentinelIssue[];
	onFix: (id: string) => void;
	onDismiss: (id: string) => void;
	onGoTo: (id: string) => void;
	onExplain: (id: string) => void;
}> = ({ filePath, issues, onFix, onDismiss, onGoTo, onExplain }) => {
	const hasCritical = issues.some(i => i.severity === 'blocker' || i.severity === 'critical');
	const [expanded, setExpanded] = useState(hasCritical);
	const activeIssues = issues.filter(i => !i.dismissed);
	const basename = filePath.split('/').pop() || filePath;
	const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));

	if (activeIssues.length === 0) return null;

	return (
		<div className="sentinel-file-group">
			<div className="sentinel-file-header" onClick={() => setExpanded(v => !v)}>
				<span className="sentinel-file-chevron" style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
					<ChevronDown size={14} />
				</span>
				<FileCode size={14} style={{ color: 'var(--void-fg-3)', flexShrink: 0 }} />
				<span className="sentinel-file-name">{basename}</span>
				<span className="sentinel-file-dir">{dirPath}</span>
				<span className={`sentinel-file-badge ${hasCritical ? 'sentinel-file-badge-critical' : 'sentinel-file-badge-normal'}`}>
					{activeIssues.length}
				</span>
			</div>
			{expanded && activeIssues.map(issue => (
				<SentinelIssueCard
					key={issue.id}
					issue={issue}
					onFix={onFix}
					onDismiss={onDismiss}
					onGoTo={onGoTo}
					onExplain={onExplain}
				/>
			))}
		</div>
	);
};


// ---- History Item ----

const HistoryItem: React.FC<{ entry: { sessionId: string; timestamp: number; mode: ReviewMode; issueCount: number; criticalCount: number; filesReviewed: number; duration: number } }> = ({ entry }) => {
	const date = new Date(entry.timestamp);
	const durationSec = Math.round(entry.duration / 1000);

	return (
		<div className="sentinel-history-item">
			<Clock size={10} />
			<span>{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
			<span className="sentinel-history-mode">{modeLabels[entry.mode]}</span>
			<span>{entry.issueCount} issues</span>
			{entry.criticalCount > 0 && <span className="sentinel-history-critical">{entry.criticalCount} critical</span>}
			<span className="sentinel-history-duration">{durationSec}s</span>
		</div>
	);
};


// ---- Main Panel ----

export const SentinelPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const accessor = useAccessor();
	const sentinelService = accessor.get('ISentinelService');
	const commandService = accessor.get('ICommandService');
	const codeEditorService = accessor.get('ICodeEditorService');

	// State
	const [session, setSession] = useState<SentinelReviewSession | null>(null);
	const [progress, setProgress] = useState<SentinelProgress | null>(null);
	const [issues, setIssues] = useState<SentinelIssue[]>([]);
	const [result, setResult] = useState<SentinelReviewResult | null>(null);
	const [reviewMode, setReviewMode] = useState<ReviewMode>('deep');
	const [showHistory, setShowHistory] = useState(false);
	const [history, setHistory] = useState(sentinelService.getHistory());
	const [severityFilter, setSeverityFilter] = useState<SentinelSeverity | 'all'>('all');
	const [searchQuery, setSearchQuery] = useState('');

	// Subscribe to service events
	useEffect(() => {
		const disposables = [
			sentinelService.onDidStartReview((s) => {
				setSession({ ...s });
				setIssues([]);
				setResult(null);
			}),
			sentinelService.onDidUpdateProgress((p) => {
				setProgress({ ...p });
			}),
			sentinelService.onDidFindIssue(() => {
				setIssues([...sentinelService.getAllIssues()]);
			}),
			sentinelService.onDidCompleteReview((r) => {
				setResult({ ...r });
				setSession(s => s ? { ...s, status: 'complete' } : null);
				setProgress(null);
				setHistory(sentinelService.getHistory());
			}),
			sentinelService.onDidDismissIssue(() => {
				setIssues([...sentinelService.getAllIssues()]);
			}),
			sentinelService.onDidApplyFix(() => {
				setIssues([...sentinelService.getAllIssues()]);
			}),
		];

		return () => disposables.forEach(d => d.dispose());
	}, [sentinelService]);

	// Filter and group issues
	const filteredIssues = useMemo(() => {
		let filtered = issues.filter(i => !i.dismissed);
		if (severityFilter !== 'all') {
			filtered = filtered.filter(i => i.severity === severityFilter);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			filtered = filtered.filter(i =>
				i.message.toLowerCase().includes(q) ||
				i.category.toLowerCase().includes(q) ||
				i.uri.fsPath.toLowerCase().includes(q) ||
				(i.cweId && i.cweId.toLowerCase().includes(q))
			);
		}
		return filtered;
	}, [issues, severityFilter, searchQuery]);

	const fileGroups = useMemo(() => {
		const groups: Record<string, SentinelIssue[]> = {};
		for (const issue of filteredIssues) {
			const path = issue.uri.fsPath;
			if (!groups[path]) groups[path] = [];
			groups[path].push(issue);
		}
		const severityOrder: Record<string, number> = { blocker: 0, critical: 1, warning: 2, info: 3 };
		return Object.entries(groups).sort(([, a], [, b]) => {
			const maxA = Math.min(...a.map(i => severityOrder[i.severity] ?? 4));
			const maxB = Math.min(...b.map(i => severityOrder[i.severity] ?? 4));
			return maxA - maxB;
		});
	}, [filteredIssues]);

	const isReviewing = session?.status === 'analyzing';
	const activeIssues = issues.filter(i => !i.dismissed);
	const fixableIssues = activeIssues.filter(i => i.autofix && !i.fixApplied);

	// Actions
	const startReview = useCallback(() => {
		sentinelService.startReview({
			mode: 'changed_files',
			reviewMode,
			confidenceThreshold: 0.7,
		});
	}, [sentinelService, reviewMode]);

	const cancelReview = useCallback(() => {
		if (session) sentinelService.cancelReview(session.id);
	}, [sentinelService, session]);

	const onFix = useCallback((issueId: string) => {
		sentinelService.applyFix(issueId);
	}, [sentinelService]);

	const onDismiss = useCallback((issueId: string) => {
		sentinelService.dismissIssue(issueId, 'User dismissed');
	}, [sentinelService]);

	const onGoTo = useCallback((issueId: string) => {
		const issue = issues.find(i => i.id === issueId);
		if (!issue) return;
		commandService.executeCommand('vscode.open', issue.uri, {
			selection: { startLineNumber: issue.startLine, startColumn: 1, endLineNumber: issue.endLine, endColumn: 1 },
		});
	}, [issues, commandService]);

	const onExplain = useCallback((issueId: string) => {
		const issue = issues.find(i => i.id === issueId);
		if (!issue) return;
		commandService.executeCommand('void.newChatAction', {
			message: `Explain this code issue found by Sentinel:\n\n**${issue.severity.toUpperCase()}** - ${issue.category}\n\n${issue.message}\n\nFile: ${issue.uri.fsPath}, lines ${issue.startLine}-${issue.endLine}\n\nSuggestion: ${issue.suggestion}`,
		});
	}, [issues, commandService]);

	const applyAllFixes = useCallback(() => {
		if (session) sentinelService.applyAllFixes(session.id);
	}, [sentinelService, session]);

	// Severity counts for badges
	const blockerCount = issues.filter(i => i.severity === 'blocker' && !i.dismissed).length;
	const criticalCount = issues.filter(i => i.severity === 'critical' && !i.dismissed).length;
	const warningCount = issues.filter(i => i.severity === 'warning' && !i.dismissed).length;
	const infoCount = issues.filter(i => i.severity === 'info' && !i.dismissed).length;

	return (
		<div className="sentinel-panel">
			{/* ── Header ── */}
			<div className="sentinel-header">
				<div className="sentinel-header-left">
					<Shield size={18} className="sentinel-shield-icon" />
					<span className="sentinel-title">Sentinel</span>
					{activeIssues.length > 0 && (
						<span className="sentinel-issue-count">{activeIssues.length}</span>
					)}
				</div>
				<div className="sentinel-header-actions">
					<button className="sentinel-icon-btn" onClick={() => setShowHistory(v => !v)} title="Review history">
						<History size={15} />
					</button>
					<button className="sentinel-icon-btn" onClick={onClose}>
						<X size={15} />
					</button>
				</div>
			</div>

			{/* ── Mode Selector Cards ── */}
			<div className="sentinel-mode-grid">
				{(Object.entries(modeConfig) as [ReviewMode, typeof modeConfig[ReviewMode]][]).map(([mode, config]) => {
					const Icon = config.icon;
					return (
						<div
							key={mode}
							className={`sentinel-mode-card ${reviewMode === mode ? 'active' : ''} ${isReviewing ? 'disabled' : ''}`}
							onClick={() => !isReviewing && setReviewMode(mode)}
						>
							<Icon size={18} className="sentinel-mode-icon" />
							<span className="sentinel-mode-label">{config.label}</span>
							<span className="sentinel-mode-desc">{config.desc}</span>
						</div>
					);
				})}
			</div>

			{/* ── Review Button ── */}
			{isReviewing ? (
				<button className="sentinel-review-btn sentinel-review-btn-stop" onClick={cancelReview}>
					<Square size={14} /> Stop Review
				</button>
			) : (
				<button className="sentinel-review-btn sentinel-review-btn-start" onClick={startReview}>
					<Play size={14} /> Start Review
				</button>
			)}

			{/* ── Progress (during review) ── */}
			{isReviewing && progress && <ProgressStepper progress={progress} />}

			{/* ── Score Dashboard (after review) ── */}
			{result && (
				<div className="sentinel-scores">
					<ScoreGauge label="Security" score={result.securityScore} />
					<ScoreGauge label="Quality" score={result.qualityScore} />
				</div>
			)}

			{/* ── Summary Badges ── */}
			{result && (blockerCount > 0 || criticalCount > 0 || warningCount > 0 || infoCount > 0) && (
				<div className="sentinel-summary">
					{blockerCount > 0 && (
						<span className="sentinel-severity-pill sentinel-pill-blocker">
							<ShieldAlert size={11} /> {blockerCount} blocker{blockerCount !== 1 ? 's' : ''}
						</span>
					)}
					{criticalCount > 0 && (
						<span className="sentinel-severity-pill sentinel-pill-critical">
							<Bug size={11} /> {criticalCount} critical
						</span>
					)}
					{warningCount > 0 && (
						<span className="sentinel-severity-pill sentinel-pill-warning">
							<AlertTriangle size={11} /> {warningCount} warning{warningCount !== 1 ? 's' : ''}
						</span>
					)}
					{infoCount > 0 && (
						<span className="sentinel-severity-pill sentinel-pill-info">
							<Info size={11} /> {infoCount} info
						</span>
					)}
				</div>
			)}

			{/* ── Apply All Fixes ── */}
			{fixableIssues.length > 0 && (
				<button className="sentinel-fix-all-btn" onClick={applyAllFixes}>
					<Zap size={14} /> Apply All Fixes ({fixableIssues.length})
				</button>
			)}

			{/* ── Filter Bar ── */}
			{activeIssues.length > 0 && (
				<div className="sentinel-filter-bar">
					<Search size={13} style={{ color: 'var(--void-fg-4)', flexShrink: 0 }} />
					<input
						type="text"
						className="sentinel-search-input"
						placeholder="Filter issues..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					{(['all', 'blocker', 'critical', 'warning', 'info'] as const).map(sev => (
						<button
							key={sev}
							className={`sentinel-filter-pill ${severityFilter === sev ? 'active' : ''}`}
							onClick={() => setSeverityFilter(sev)}
						>
							{sev === 'all' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
						</button>
					))}
					{filteredIssues.length !== activeIssues.length && (
						<span className="sentinel-filter-count">{filteredIssues.length}/{activeIssues.length}</span>
					)}
				</div>
			)}

			{/* ── Issues List ── */}
			<div className="sentinel-issues-list">
				{!session && !isReviewing && activeIssues.length === 0 ? (
					<div className="sentinel-empty">
						<ShieldCheck size={36} className="sentinel-empty-icon" />
						<p className="sentinel-empty-text">
							Select a review mode and click <strong>Start Review</strong> to analyze your code changes
						</p>
					</div>
				) : activeIssues.length === 0 && session?.status === 'complete' ? (
					<div className="sentinel-empty">
						<ShieldCheck size={36} className="sentinel-empty-icon sentinel-empty-success" style={{ opacity: 0.7, animation: 'none' }} />
						<p className="sentinel-empty-text" style={{ color: '#10b981' }}>
							No issues found — your code looks great!
						</p>
					</div>
				) : isReviewing && activeIssues.length === 0 ? (
					<div className="sentinel-empty">
						<Loader2 size={28} className="sentinel-spinner" style={{ color: '#10b981' }} />
						<p className="sentinel-empty-text">Analyzing your code changes...</p>
					</div>
				) : (
					fileGroups.map(([filePath, fileIssues]) => (
						<SentinelFileGroup
							key={filePath}
							filePath={filePath}
							issues={fileIssues}
							onFix={onFix}
							onDismiss={onDismiss}
							onGoTo={onGoTo}
							onExplain={onExplain}
						/>
					))
				)}
			</div>

			{/* ── History Drawer ── */}
			{showHistory && history.length > 0 && (
				<div className="sentinel-history">
					<div className="sentinel-history-header">
						<History size={13} />
						<span>Review History</span>
					</div>
					<div className="sentinel-history-list">
						{history.slice(0, 10).map(entry => (
							<HistoryItem key={entry.sessionId} entry={entry} />
						))}
					</div>
				</div>
			)}

			{/* ── Footer ── */}
			{result && (
				<div className="sentinel-footer">
					{result.summary} · {result.reviewedFiles} files reviewed · {modeLabels[result.mode]}
				</div>
			)}
		</div>
	);
};
