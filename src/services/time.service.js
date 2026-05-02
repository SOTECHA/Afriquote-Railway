/**
 * AfriQuote — Time Tracking Service
 */

'use strict';

const db        = require('../utils/db');
const { newId } = require('../utils/auth');

/* ─── Timer ─── */
function startTimer(userId, { projectId, projectName, task, billable = true }) {
  // Auto-stop any running timer
  const running = db.findOne('timers', t => t.userId === userId && !t.endAt);
  if (running) stopTimer(userId);

  const timer = {
    id:          newId(),
    userId,
    projectId:   projectId || null,
    projectName: projectName || null,
    task:        task || null,
    billable,
    startAt:     new Date().toISOString(),
    endAt:       null,
    durationSecs: null,
  };
  return db.insert('timers', timer);
}

function stopTimer(userId) {
  const timer = db.findOne('timers', t => t.userId === userId && !t.endAt);
  if (!timer) return { error: 'No running timer' };
  const endAt       = new Date().toISOString();
  const durationSecs = Math.round((new Date(endAt) - new Date(timer.startAt)) / 1000);
  return db.update('timers', t => t.id === timer.id, { endAt, durationSecs });
}

function getRunningTimer(userId) {
  const t = db.findOne('timers', t => t.userId === userId && !t.endAt);
  if (!t) return null;
  return { ...t, durationSecs: Math.round((Date.now() - new Date(t.startAt)) / 1000) };
}

/* ─── Manual log entry ─── */
function logTime(userId, { projectId, projectName, task, date, hours, minutes, billable = true, hourlyRate, currency }) {
  const durationSecs = ((Number(hours) || 0) * 3600) + ((Number(minutes) || 0) * 60);
  const entry = {
    id:          newId(),
    userId,
    projectId:   projectId || null,
    projectName: projectName || null,
    task:        task || null,
    date:        date || new Date().toISOString().split('T')[0],
    durationSecs,
    billable,
    hourlyRate:  hourlyRate ? Number(hourlyRate) : null,
    currency:    currency   || null,
    billableValue: hourlyRate ? Math.round((durationSecs / 3600) * hourlyRate * 100) / 100 : null,
    billed:      false,
    startAt:     new Date().toISOString(),
    endAt:       new Date().toISOString(),
    source:      'manual',
    createdAt:   new Date().toISOString(),
  };
  return db.insert('timers', entry);
}

function listTimeLogs(userId, filters = {}) {
  let logs = db.find('timers', t => t.userId === userId && t.endAt);
  if (filters.projectId) logs = logs.filter(t => t.projectId === filters.projectId);
  if (filters.from)      logs = logs.filter(t => (t.date || t.startAt) >= filters.from);
  if (filters.to)        logs = logs.filter(t => (t.date || t.startAt) <= filters.to);
  if (filters.billable !== undefined) logs = logs.filter(t => t.billable === (filters.billable === 'true' || filters.billable === true));
  return logs.sort((a, b) => new Date(b.startAt || b.date) - new Date(a.startAt || a.date));
}

/** Mark entries as billed (after invoice generated) */
function markBilled(userId, entryIds, invoiceId) {
  entryIds.forEach(id => {
    const t = db.findOne('timers', t => t.id === id && t.userId === userId);
    if (t) db.update('timers', t => t.id === id, { billed: true, invoiceId });
  });
}

/* ─── Reports ─── */
function timeReport(userId, from, to) {
  const logs = listTimeLogs(userId, { from, to });

  const totalSecs    = logs.reduce((s, t) => s + (t.durationSecs || 0), 0);
  const billableSecs = logs.filter(t => t.billable).reduce((s, t) => s + (t.durationSecs || 0), 0);
  const billableValue= logs.filter(t => t.billable && t.billableValue).reduce((s, t) => s + t.billableValue, 0);

  const byProject = {};
  logs.forEach(t => {
    const key = t.projectName || t.projectId || 'Unassigned';
    if (!byProject[key]) byProject[key] = { secs: 0, billableSecs: 0, value: 0 };
    byProject[key].secs        += t.durationSecs || 0;
    byProject[key].billableSecs+= t.billable ? (t.durationSecs || 0) : 0;
    byProject[key].value       += t.billableValue || 0;
  });

  return {
    from, to,
    totalHours:      Math.round(totalSecs / 36) / 100,
    billableHours:   Math.round(billableSecs / 36) / 100,
    nonBillableHours:Math.round((totalSecs - billableSecs) / 36) / 100,
    utilisationRate: totalSecs ? Math.round(billableSecs / totalSecs * 100) : 0,
    billableValue:   Math.round(billableValue * 100) / 100,
    unbilledValue:   logs.filter(t => t.billable && !t.billed && t.billableValue).reduce((s, t) => s + t.billableValue, 0),
    byProject:       Object.entries(byProject).map(([name, v]) => ({ name, hours: Math.round(v.secs/36)/100, billableHours: Math.round(v.billableSecs/36)/100, value: Math.round(v.value*100)/100 })),
    entries:         logs,
  };
}

/* ─── Rate calculator ─── */
function calculateMinRate({ targetMonthly, billableHours, expenses, taxRate }) {
  const tm  = Number(targetMonthly) || 0;
  const bh  = Number(billableHours)  || 80;
  const exp = Number(expenses)       || 0;
  const tax = Number(taxRate)        || 0;
  if (!tm || !bh) return null;
  const grossNeeded = (tm + exp) / (1 - tax / 100);
  return { minimumHourlyRate: Math.ceil(grossNeeded / bh / 100) * 100, grossNeeded, billableHours: bh };
}

module.exports = {
  startTimer, stopTimer, getRunningTimer,
  logTime, listTimeLogs, markBilled,
  timeReport, calculateMinRate,
};
