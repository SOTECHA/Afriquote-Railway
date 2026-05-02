/**
 * AfriQuote — Site Monitoring Service
 */

'use strict';

const db     = require('../utils/db');
const { newId } = require('../utils/auth');

const SITE_STATUSES    = ['planning', 'active', 'on_track', 'delayed', 'at_risk', 'paused', 'completed'];
const TASK_STATUSES    = ['todo', 'in_progress', 'blocked', 'done', 'overdue'];
const MILESTONE_STATUS = ['upcoming', 'active', 'done', 'blocked'];

/* ─── Sites ─── */
function createSite(userId, payload) {
  const site = {
    id:         newId(),
    userId,
    status:     'active',
    progress:   0,
    teamIds:    [],
    tasks:      [],
    milestones: [],
    documents:  [],
    createdAt:  new Date().toISOString(),
    ...payload,
  };
  return db.insert('sites', site);
}

function listSites(userId) {
  return db.find('sites', s => s.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getSite(id, userId) {
  const s = db.findOne('sites', s => s.id === id);
  if (!s || s.userId !== userId) return null;
  return withComputedProgress(s);
}

function updateSite(id, userId, patch) {
  if (!getSite(id, userId)) return null;
  return db.update('sites', s => s.id === id, patch);
}

function withComputedProgress(site) {
  const tasks = site.tasks || [];
  if (!tasks.length) return site;
  const done = tasks.filter(t => t.status === 'done').length;
  return { ...site, progress: Math.round((done / tasks.length) * 100) };
}

/* ─── Tasks ─── */
function addTask(siteId, userId, task) {
  const site = getSite(siteId, userId);
  if (!site) return null;
  const t = {
    id:        newId(),
    status:    'todo',
    priority:  'medium',
    createdAt: new Date().toISOString(),
    ...task,
  };
  const tasks = [...(site.tasks || []), t];
  db.update('sites', s => s.id === siteId, { tasks });
  return t;
}

function updateTask(siteId, userId, taskId, patch) {
  const site = getSite(siteId, userId);
  if (!site) return null;
  // Auto-mark overdue
  const tasks = (site.tasks || []).map(t => {
    if (t.id !== taskId) return t;
    const updated = { ...t, ...patch, updatedAt: new Date().toISOString() };
    if (updated.status === 'done' && !updated.completedAt) {
      updated.completedAt = new Date().toISOString();
    }
    if (updated.dueDate && updated.status !== 'done' && new Date(updated.dueDate) < new Date()) {
      updated.status = 'overdue';
    }
    return updated;
  });
  db.update('sites', s => s.id === siteId, { tasks });
  return tasks.find(t => t.id === taskId);
}

/* ─── Milestones ─── */
function addMilestone(siteId, userId, milestone) {
  const site = getSite(siteId, userId);
  if (!site) return null;
  const m = {
    id:        newId(),
    status:    'upcoming',
    createdAt: new Date().toISOString(),
    ...milestone,
  };
  const milestones = [...(site.milestones || []), m];
  db.update('sites', s => s.id === siteId, { milestones });
  return m;
}

function updateMilestone(siteId, userId, milestoneId, patch) {
  const site = getSite(siteId, userId);
  if (!site) return null;
  const milestones = (site.milestones || []).map(m =>
    m.id === milestoneId ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m
  );
  db.update('sites', s => s.id === siteId, { milestones });
  return milestones.find(m => m.id === milestoneId);
}

/* ─── Check-in / Check-out ─── */
function checkIn(userId, { siteId, lat, lng, note }) {
  // Close any open check-in
  const open = db.findOne('checkins', c => c.userId === userId && !c.checkOutAt);
  if (open) {
    db.update('checkins', c => c.id === open.id, {
      checkOutAt: new Date().toISOString(),
      autoCheckout: true,
    });
  }
  const record = {
    id:          newId(),
    userId,
    siteId,
    checkInAt:   new Date().toISOString(),
    checkOutAt:  null,
    lat:         lat || null,
    lng:         lng || null,
    note:        note || null,
  };
  return db.insert('checkins', record);
}

function checkOut(userId, { note } = {}) {
  const open = db.findOne('checkins', c => c.userId === userId && !c.checkOutAt);
  if (!open) return { error: 'No active check-in' };
  const checkOutAt = new Date().toISOString();
  const duration   = Math.round((new Date(checkOutAt) - new Date(open.checkInAt)) / 60000); // minutes
  return db.update('checkins', c => c.id === open.id, { checkOutAt, duration, note: note || null });
}

function getActiveCheckIn(userId) {
  return db.findOne('checkins', c => c.userId === userId && !c.checkOutAt) || null;
}

function getCheckInHistory(userId, siteId, limit = 50) {
  let records = db.find('checkins', c => c.userId === userId);
  if (siteId) records = records.filter(c => c.siteId === siteId);
  return records.sort((a, b) => new Date(b.checkInAt) - new Date(a.checkInAt)).slice(0, limit);
}

/* ─── Field Log ─── */
const LOG_TYPES = ['progress', 'issue', 'delivery', 'inspection', 'weather_hold', 'visitor', 'note'];

function addFieldLog(userId, { siteId, type, message, attachments }) {
  if (!LOG_TYPES.includes(type)) type = 'note';
  const entry = {
    id:          newId(),
    userId,
    siteId,
    type,
    message,
    attachments: attachments || [],
    createdAt:   new Date().toISOString(),
  };
  return db.insert('fieldlogs', entry);
}

function getFieldLog(userId, siteId, limit = 100) {
  let logs = db.find('fieldlogs', l => l.userId === userId);
  if (siteId) logs = logs.filter(l => l.siteId === siteId);
  return logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

/* ─── Site stats ─── */
function siteStats(userId) {
  const sites = listSites(userId);
  return {
    total:       sites.length,
    active:      sites.filter(s => ['active','on_track'].includes(s.status)).length,
    delayed:     sites.filter(s => s.status === 'delayed').length,
    atRisk:      sites.filter(s => s.status === 'at_risk').length,
    completed:   sites.filter(s => s.status === 'completed').length,
    totalTasks:  sites.reduce((n, s) => n + (s.tasks || []).length, 0),
    overdueTasks:sites.reduce((n, s) => n + (s.tasks || []).filter(t => t.status === 'overdue').length, 0),
  };
}

module.exports = {
  SITE_STATUSES, TASK_STATUSES, MILESTONE_STATUS, LOG_TYPES,
  createSite, listSites, getSite, updateSite,
  addTask, updateTask,
  addMilestone, updateMilestone,
  checkIn, checkOut, getActiveCheckIn, getCheckInHistory,
  addFieldLog, getFieldLog,
  siteStats,
};
