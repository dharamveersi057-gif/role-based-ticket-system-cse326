(function () {
  'use strict';

  /* ================= constants ================= */
  var HOUR = 3600000;
  var STORE_KEY = 'relaydesk.data.v1';
  var SESSION_KEY = 'relaydesk.session.v1';
  var STATUSES = ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed'];
  var PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
  var CATEGORIES = ['Billing', 'Technical', 'Account', 'Feature request', 'Other'];
  var SLA_HOURS = { Urgent: 4, High: 8, Medium: 24, Low: 72 };
  var ROLE_LABEL = { admin: 'Admin', agent: 'Agent', customer: 'Customer' };

  /* ================= storage (localStorage with in-memory fallback) ================= */
  var mem = {};
  function lsGet(k) {
    try { var v = window.localStorage.getItem(k); if (v !== null) return v; } catch (e) {}
    return mem[k] === undefined ? null : mem[k];
  }
  function lsSet(k, v) {
    mem[k] = v;
    try { window.localStorage.setItem(k, v); } catch (e) {}
  }

  var db = null;
  var sessionId = null;
  var ui = {
    q: '', status: 'all', priority: 'all', scope: 'all', sort: 'updated',
    drafts: {}, confirmDelete: null, confirmReset: false, lastRoute: ''
  };

  function save() { lsSet(STORE_KEY, JSON.stringify(db)); }

  function load() {
    var raw = lsGet(STORE_KEY);
    if (raw) {
      try {
        var d = JSON.parse(raw);
        if (d && d.users && d.tickets && d.nextId) { db = d; return; }
      } catch (e) {}
    }
    db = seedData();
    save();
  }

  /* ================= demo data ================= */
  function seedData() {
    var now = Date.now();
    var users = [
      { id: 1, name: 'Meera Iyer', email: 'meera@relaydesk.example', role: 'admin', active: true },
      { id: 2, name: 'Arjun Rao', email: 'arjun@relaydesk.example', role: 'agent', active: true },
      { id: 3, name: 'Sana Khan', email: 'sana@relaydesk.example', role: 'agent', active: true },
      { id: 4, name: 'Rohit Verma', email: 'rohit@acmefoods.example', role: 'customer', active: true },
      { id: 5, name: 'Priya Nair', email: 'priya@brightlabs.example', role: 'customer', active: true },
      { id: 6, name: 'Dev Patel', email: 'dev@patelworks.example', role: 'customer', active: true }
    ];
    function nm(id) {
      for (var i = 0; i < users.length; i++) if (users[i].id === id) return users[i].name;
      return 'Unknown';
    }
    function build(id, o) {
      var created = now - o.age * HOUR;
      var t = {
        id: id, title: o.title, description: o.desc, category: o.cat, priority: o.pri,
        status: o.status, requester: o.req, assignee: o.asg || null,
        created: created, updated: created, resolvedAt: null, comments: [], history: []
      };
      function hist(at, by, text, internal) {
        t.history.push({ at: at, by: by, text: text, internal: !!internal });
        if (at > t.updated) t.updated = at;
      }
      hist(created, o.req, 'Created the ticket');
      if (o.asg) hist(created + HOUR * 0.4, o.asg, 'Assigned to ' + nm(o.asg));
      var actor = o.asg || 1;
      if (o.status === 'On Hold') {
        hist(created + HOUR * 0.8, actor, 'Changed status from Open to On Hold');
      } else if (o.status !== 'Open') {
        hist(created + HOUR * 0.8, actor, 'Changed status from Open to In Progress');
      }
      if (o.status === 'Resolved' || o.status === 'Closed') {
        t.resolvedAt = created + (o.res || 4) * HOUR;
        hist(t.resolvedAt, actor, 'Changed status from In Progress to Resolved');
        if (o.status === 'Closed') hist(t.resolvedAt + HOUR, o.req, 'Changed status from Resolved to Closed');
      }
      (o.c || []).forEach(function (c, i) {
        var at = created + c[1] * HOUR;
        t.comments.push({ id: id * 100 + i, author: c[0], body: c[2], internal: !!c[3], at: at });
        hist(at, c[0], c[3] ? 'Added an internal note' : 'Replied', c[3]);
      });
      return t;
    }
    var specs = [
      { title: 'Duplicate charge on the October invoice', cat: 'Billing', pri: 'High', status: 'In Progress', req: 4, asg: 2, age: 30,
        desc: 'Our October invoice shows two charges of ₹4,999 on 3 Oct. Please check and refund the extra one.',
        c: [[2, 1.5, 'Thanks for flagging this. I can see both charges on 3 Oct. I am checking with the payments team now.'],
            [2, 2, 'Gateway shows one settlement and one pending authorisation. Waiting for the bank to confirm.', true],
            [4, 6, 'Any update? My bank statement still shows both amounts.']] },
      { title: 'Password reset link says it has expired', cat: 'Account', pri: 'Urgent', status: 'Open', req: 5, asg: null, age: 3,
        desc: 'I cannot sign in. The reset email arrives but the link says expired as soon as I open it.',
        c: [[5, 0.3, 'Tried three times in Chrome and Safari with the same result.']] },
      { title: 'CSV export drops the last column', cat: 'Technical', pri: 'Medium', status: 'In Progress', req: 6, asg: 3, age: 50,
        desc: 'When I export the orders report to CSV the final column (Delivery notes) is missing.',
        c: [[3, 4, 'Reproduced with a 12 column file. Raised with engineering.'],
            [3, 4.2, 'Linked to the export module bug. Fix is planned for the next release.', true]] },
      { title: 'Dark mode for the customer portal', cat: 'Feature request', pri: 'Low', status: 'Open', req: 4, asg: null, age: 120,
        desc: 'Our team works late and would like a dark theme in the portal.' },
      { title: 'Dashboard loads slowly on mobile', cat: 'Technical', pri: 'High', status: 'On Hold', req: 5, asg: 2, age: 70,
        desc: 'The reports dashboard takes about 20 seconds to load on my phone.',
        c: [[2, 5, 'Could you share the phone model and which screens are slow? Paused until we hear from you.']] },
      { title: 'Update billing contact email', cat: 'Account', pri: 'Low', status: 'Resolved', req: 6, asg: 3, age: 40, res: 5,
        desc: 'Please change the billing contact to accounts@patelworks.example.',
        c: [[3, 2, 'Billing contact updated. Tell us if the next invoice still goes to the old address.']] },
      { title: 'API returns 500 on bulk import', cat: 'Technical', pri: 'Urgent', status: 'Resolved', req: 4, asg: 2, age: 26, res: 3,
        desc: 'Bulk import of 4,000 rows fails with HTTP 500 after about a minute.',
        c: [[2, 1, 'Cause found: a batch size limit on the import worker. Raised it and re-ran your file.'],
            [4, 3.5, 'Import worked. Thanks for the quick turnaround.']] },
      { title: 'GST number missing from invoice PDF', cat: 'Billing', pri: 'Medium', status: 'Closed', req: 5, asg: 3, age: 200, res: 20,
        desc: 'Our accountant needs the GSTIN printed on every invoice PDF.',
        c: [[3, 6, 'GSTIN added to the invoice template. New PDFs will include it.']] },
      { title: 'Add a team member to the workspace', cat: 'Account', pri: 'Low', status: 'Closed', req: 6, asg: 2, age: 150, res: 2,
        desc: 'Please invite nikhil@patelworks.example as a member.' },
      { title: 'Notification emails arrive twice', cat: 'Technical', pri: 'Medium', status: 'Open', req: 4, asg: 3, age: 10,
        desc: 'Every assignment alert is delivered two times to the same inbox.',
        c: [[4, 1, 'It only happens for assignment alerts, not comments.']] },
      { title: 'Refund for unused seats', cat: 'Billing', pri: 'High', status: 'Open', req: 6, asg: null, age: 9,
        desc: 'We reduced from 25 to 18 seats last month but were billed for 25. Please refund the difference.',
        c: [[6, 0.2, 'Plan change confirmation attached to the original order email.']] },
      { title: 'Single sign-on setup guidance', cat: 'Other', pri: 'Medium', status: 'In Progress', req: 5, asg: 3, age: 20,
        desc: 'We want staff to sign in with our company identity provider. What are the steps?',
        c: [[3, 3, 'Which identity provider do you use? We support Okta and Azure AD.'],
            [5, 6, 'Azure AD.']] }
    ];
    var tickets = specs.map(function (o, i) { return build(1001 + i, o); });
    return { users: users, tickets: tickets, nextId: 1001 + specs.length, nextUserId: 7 };
  }

  /* ================= small helpers ================= */
  function h(tag, props) {
    var node = document.createElement(tag);
    var deferredValue;
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'value') deferredValue = v;
        else if (k === 'style') Object.keys(v).forEach(function (p) { node.style.setProperty(p, v[p]); });
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (k === 'checked' || k === 'disabled') node[k] = true;
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    if (deferredValue !== undefined) node.value = deferredValue;
    return node;
  }
  function append(node, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(node, x); }); return; }
    if (typeof c === 'string' || typeof c === 'number') { node.appendChild(document.createTextNode(String(c))); return; }
    node.appendChild(c);
  }
  function slug(s) { return s.toLowerCase().replace(/\s+/g, '-'); }
  function initials(name) {
    return name.split(/\s+/).map(function (p) { return p.charAt(0); }).slice(0, 2).join('').toUpperCase();
  }
  function ago(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var hr = Math.round(m / 60);
    if (hr < 24) return hr + ' h ago';
    return Math.round(hr / 24) + ' d ago';
  }
  function fullDate(ts) {
    return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function dur(ms) {
    var hrs = ms / HOUR;
    if (hrs < 1) return Math.max(1, Math.round(ms / 60000)) + ' min';
    if (hrs < 48) return Math.round(hrs) + ' h';
    return Math.round(hrs / 24) + ' d';
  }
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = '';
    el.appendChild(h('span', { text: msg }));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ================= domain ================= */
  function userById(id) {
    for (var i = 0; i < db.users.length; i++) if (db.users[i].id === id) return db.users[i];
    return null;
  }
  function userName(id) { var u = userById(id); return u ? u.name : 'Unknown'; }
  function me() { return sessionId ? userById(sessionId) : null; }
  function isStaff(u) { return !!u && (u.role === 'admin' || u.role === 'agent'); }
  function staffUsers() { return db.users.filter(function (u) { return u.active && isStaff(u); }); }
  function ticketById(id) {
    for (var i = 0; i < db.tickets.length; i++) if (db.tickets[i].id === id) return db.tickets[i];
    return null;
  }
  function code(t) { return 'TKT-' + t.id; }
  function canView(u, t) { return isStaff(u) || t.requester === u.id; }
  function visibleTickets() {
    var u = me();
    if (!u) return [];
    return db.tickets.filter(function (t) { return canView(u, t); });
  }
  function isActive(t) { return t.status !== 'Resolved' && t.status !== 'Closed'; }
  function dueAt(t) { return t.created + SLA_HOURS[t.priority] * HOUR; }
  function isOverdue(t) { return isActive(t) && t.status !== 'On Hold' && Date.now() > dueAt(t); }
  function dueInfo(t) {
    if (!isActive(t)) return { text: 'Done', cls: 'muted' };
    if (t.status === 'On Hold') return { text: 'SLA paused', cls: 'muted' };
    var left = dueAt(t) - Date.now();
    if (left < 0) return { text: 'Overdue by ' + dur(-left), cls: 'due-late' };
    return { text: 'Due in ' + dur(left), cls: left < 2 * HOUR ? 'due-soon' : '' };
  }
  function log(t, by, text, internal) {
    t.history.push({ at: Date.now(), by: by, text: text, internal: !!internal });
    t.updated = Date.now();
  }

  function allowedStatuses(u, t) {
    if (isStaff(u)) return STATUSES.filter(function (s) { return s !== t.status; });
    if (t.requester !== u.id) return [];
    if (t.status === 'Resolved') return ['Closed', 'Open'];
    if (t.status === 'Closed') return ['Open'];
    if (t.status === 'Open') return ['Closed'];
    return [];
  }
  function statusActionLabel(u, t, to) {
    if (isStaff(u)) return 'Move to ' + to;
    if (t.status === 'Resolved' && to === 'Closed') return 'Confirm fixed and close';
    if (to === 'Open') return 'Reopen ticket';
    return 'Withdraw ticket';
  }

  function changeStatus(t, to) {
    var u = me();
    if (!u || allowedStatuses(u, t).indexOf(to) < 0) return;
    var from = t.status;
    t.status = to;
    if (isStaff(u) && !t.assignee && (to === 'In Progress' || to === 'Resolved')) {
      t.assignee = u.id;
      log(t, u.id, 'Assigned to ' + u.name + ' (automatic)');
    }
    if (to === 'Resolved') t.resolvedAt = Date.now();
    if (to === 'Open' && (from === 'Resolved' || from === 'Closed')) t.resolvedAt = null;
    log(t, u.id, 'Changed status from ' + from + ' to ' + to);
    save();
    toast(code(t) + ' is now ' + to);
    render();
  }
  function setAssignee(t, id) {
    var u = me();
    if (!isStaff(u)) return;
    t.assignee = id;
    log(t, u.id, id ? 'Assigned to ' + userName(id) : 'Unassigned the ticket');
    save();
    toast(id ? 'Assigned to ' + userName(id) : 'Ticket unassigned');
    render();
  }
  function setPriority(t, p) {
    var u = me();
    if (!isStaff(u) || t.priority === p) return;
    var old = t.priority;
    t.priority = p;
    log(t, u.id, 'Changed priority from ' + old + ' to ' + p);
    save();
    toast('Priority set to ' + p);
    render();
  }
  function addComment(t, body, internal) {
    var u = me();
    body = (body || '').trim();
    if (!u || !body) return false;
    var isNote = !!internal && isStaff(u);
    t.comments.push({ id: Date.now(), author: u.id, body: body, internal: isNote, at: Date.now() });
    log(t, u.id, isNote ? 'Added an internal note' : 'Replied', isNote);
    if (!isStaff(u)) {
      if (t.status === 'Resolved') {
        t.status = 'Open'; t.resolvedAt = null;
        log(t, u.id, 'Reopened the ticket by replying');
      } else if (t.status === 'On Hold') {
        t.status = 'In Progress';
        log(t, u.id, 'Resumed work by replying');
      }
    }
    save();
    return true;
  }
  function createTicket(data) {
    var u = me();
    var t = {
      id: db.nextId++, title: data.title, description: data.description, category: data.category,
      priority: data.priority, status: 'Open', requester: data.requester, assignee: null,
      created: Date.now(), updated: Date.now(), resolvedAt: null, comments: [], history: []
    };
    log(t, u.id, data.requester === u.id ? 'Created the ticket' : 'Created the ticket on behalf of ' + userName(data.requester));
    db.tickets.push(t);
    save();
    return t;
  }

  /* ================= view helpers ================= */
  function statusPill(s) { return h('span', { class: 'pill s-' + slug(s), text: s }); }
  function prio(p) { return h('span', { class: 'prio p-' + slug(p) }, h('i'), p); }
  function roleBadge(role) { return h('span', { class: 'role role-' + role, text: ROLE_LABEL[role] }); }
  function field(label, control, id, err) {
    return h('div', { class: 'field' + (err ? ' has-error' : '') },
      h('label', { for: id, text: label }), control, err ? h('span', { class: 'err', text: err }) : null);
  }
  function select(id, options, current, onchange) {
    return h('select', { id: id, onchange: onchange, value: current },
      options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
  }
  function ticketLink(t) { return h('a', { href: '#ticket-' + t.id, class: 'mono', text: code(t) }); }

  function collectActivity(tickets, includeInternal) {
    var items = [];
    tickets.forEach(function (t) {
      t.history.forEach(function (e) {
        if (e.internal && !includeInternal) return;
        items.push({ at: e.at, by: e.by, text: e.text, ticket: t });
      });
    });
    items.sort(function (a, b) { return b.at - a.at; });
    return items;
  }
  function activityRows(items) {
    if (!items.length) return h('p', { class: 'empty', text: 'No activity yet.' });
    return h('div', { class: 'rows' }, items.map(function (e) {
      return h('div', { class: 'row' },
        h('div', { class: 'title' }, h('strong', { text: userName(e.by) }), ' ' + e.text.charAt(0).toLowerCase() + e.text.slice(1)),
        h('span', { class: 'muted small', text: ago(e.at) }),
        h('div', { class: 'meta' }, ticketLink(e.ticket), ' · ' + e.ticket.title));
    }));
  }

  /* ================= routing & shell ================= */
  function parseRoute() {
    var hash = (window.location.hash || '').replace('#', '');
    var m = /^ticket-(\d+)$/.exec(hash);
    if (m) return { name: 'ticket', id: parseInt(m[1], 10) };
    return { name: hash || 'dashboard' };
  }
  function navItems(u) {
    var items = [
      { id: 'dashboard', label: 'Overview' },
      { id: 'tickets', label: isStaff(u) ? 'All tickets' : 'My tickets' },
      { id: 'new', label: 'New ticket' }
    ];
    if (isStaff(u)) items.push({ id: 'reports', label: 'Reports' });
    if (u.role === 'admin') { items.push({ id: 'users', label: 'Users' }); items.push({ id: 'activity', label: 'Activity' }); }
    return items;
  }

  function headerView(u, route) {
    var current = route.name === 'ticket' ? 'tickets' : route.name;
    var nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, navItems(u).map(function (n) {
      return h('a', { href: '#' + n.id, class: 'nav-link' + (current === n.id ? ' is-active' : ''),
        'aria-current': current === n.id ? 'page' : null, text: n.label });
    }));
    return h('header', { class: 'topbar' },
      h('div', { class: 'wrap topbar-in' },
        h('a', { class: 'brand', href: '#dashboard' }, h('span', { class: 'brand-mark', text: 'RD' }), 'Relay Desk'),
        nav,
        h('div', { class: 'userbox' },
          h('div', { class: 'who' }, h('strong', { text: u.name }), roleBadge(u.role)),
          h('span', { class: 'avatar', text: initials(u.name), 'aria-hidden': 'true' }),
          h('button', { class: 'btn btn-sm', type: 'button', text: 'Sign out', onclick: signOut }))));
  }

  function render() {
    var app = document.getElementById('app');
    if (!app) return;
    app.textContent = '';
    var u = me();
    if (u && !u.active) { sessionId = null; u = null; }
    if (!u) { app.appendChild(loginView()); return; }
    var route = parseRoute();
    var allowed = navItems(u).map(function (n) { return n.id; });
    if (route.name !== 'ticket' && allowed.indexOf(route.name) < 0) route = { name: 'dashboard' };
    var key = route.name + (route.id || '');
    if (key !== ui.lastRoute) { ui.lastRoute = key; window.scrollTo(0, 0); }

    var main = h('main', { class: 'wrap main', id: 'main' });
    var view;
    if (route.name === 'dashboard') view = dashboardView(u);
    else if (route.name === 'tickets') view = ticketsView(u);
    else if (route.name === 'new') view = newView(u);
    else if (route.name === 'reports') view = reportsView(u);
    else if (route.name === 'users') view = usersView(u);
    else if (route.name === 'activity') view = activityView(u);
    else if (route.name === 'ticket') view = ticketView(u, ticketById(route.id));
    main.appendChild(view);
    app.appendChild(headerView(u, route));
    app.appendChild(main);
  }

  function signIn(id) {
    sessionId = id;
    lsSet(SESSION_KEY, String(id));
    ui.lastRoute = '';
    if (window.location.hash && window.location.hash !== '#dashboard') window.location.hash = 'dashboard';
    render();
  }
  function signOut() {
    sessionId = null;
    lsSet(SESSION_KEY, '');
    ui.lastRoute = '';
    render();
  }

  /* ================= login ================= */
  function loginView() {
    var blurbs = {
      customer: ['Raise tickets and follow their progress', 'Reply to staff and reopen or close your own tickets', 'See only your own tickets'],
      agent: ['Work the shared queue and assign tickets', 'Change status and priority, add internal notes', 'View reports on workload and SLA'],
      admin: ['Everything an agent can do', 'Manage users, roles and access', 'Delete tickets and review the activity log']
    };
    var cards = ['customer', 'agent', 'admin'].map(function (role) {
      var people = db.users.filter(function (u) { return u.role === role && u.active; });
      return h('section', { class: 'panel role-card' },
        h('div', { class: 'panel-head' }, h('h2', { text: ROLE_LABEL[role] }), roleBadge(role)),
        h('ul', null, blurbs[role].map(function (b) { return h('li', { text: b }); })),
        h('div', { class: 'login-users' }, people.map(function (u) {
          return h('button', { class: 'user-btn', type: 'button', onclick: function () { signIn(u.id); } },
            h('span', { class: 'avatar', text: initials(u.name), 'aria-hidden': 'true' }),
            h('span', null, u.name, h('small', { text: u.email })));
        })));
    });
    return h('main', { class: 'wrap login' },
      h('div', { class: 'login-head' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark', text: 'RD' }), 'Relay Desk'),
        h('h1', { text: 'Sign in to the service desk' }),
        h('p', { class: 'muted', text: 'This is a demo workspace. Pick an account to see the desk from that role. Data is saved in this browser only.' })),
      h('div', { class: 'role-cards' }, cards));
  }

  /* ================= dashboard ================= */
  function dashboardView(u) {
    var ts = visibleTickets();
    var staff = isStaff(u);
    var now = Date.now();
    var tiles;
    if (staff) {
      tiles = [
        ['Open queue', ts.filter(function (t) { return t.status === 'Open'; }).length, 'waiting for first action', false],
        ['In progress', ts.filter(function (t) { return t.status === 'In Progress'; }).length, 'being worked on', false],
        ['Overdue', ts.filter(isOverdue).length, 'past the SLA target', true],
        ['Unassigned', ts.filter(function (t) { return isActive(t) && !t.assignee; }).length, 'need an owner', false],
        ['Resolved, 7 days', ts.filter(function (t) { return t.resolvedAt && now - t.resolvedAt < 168 * HOUR; }).length, 'closed out this week', false]
      ];
    } else {
      tiles = [
        ['Active', ts.filter(isActive).length, 'tickets in progress', false],
        ['Needs you', ts.filter(function (t) { return t.status === 'On Hold' || t.status === 'Resolved'; }).length, 'reply or confirm', false],
        ['Resolved', ts.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length, 'finished', false],
        ['All tickets', ts.length, 'raised by you', false]
      ];
    }
    var attention;
    if (staff) {
      attention = ts.filter(function (t) { return isOverdue(t) || (isActive(t) && t.priority === 'Urgent'); })
        .sort(function (a, b) { return dueAt(a) - dueAt(b); }).slice(0, 6);
    } else {
      attention = ts.filter(function (t) { return t.status === 'On Hold' || t.status === 'Resolved'; })
        .sort(function (a, b) { return b.updated - a.updated; }).slice(0, 6);
    }
    var attentionBody = attention.length ? h('div', { class: 'rows' }, attention.map(function (t) {
      var d = dueInfo(t);
      var hint = staff ? d.text : (t.status === 'Resolved' ? 'Confirm it is fixed' : 'Waiting for your reply');
      return h('div', { class: 'row' },
        h('div', { class: 'title' }, h('a', { href: '#ticket-' + t.id, text: t.title })),
        statusPill(t.status),
        h('div', { class: 'meta' }, h('span', { class: 'mono', text: code(t) }), ' · ', prio(t.priority), ' · ',
          h('span', { class: staff ? d.cls : '', text: hint })));
    })) : h('p', { class: 'empty', text: staff ? 'Nothing is overdue or urgent.' : 'Nothing is waiting on you.' });

    var recent = collectActivity(ts, staff).slice(0, 7);

    return h('div', { class: 'main', style: { padding: '0' } },
      h('div', { class: 'page-head' },
        h('div', null, h('h1', { text: 'Hello, ' + u.name.split(' ')[0] }),
          h('p', { text: staff ? 'Here is where the queue stands right now.' : 'Here is where your tickets stand.' })),
        h('a', { class: 'btn btn-primary', href: '#new', text: 'New ticket' })),
      h('div', { class: 'stats' }, tiles.map(function (t) {
        return h('div', { class: 'stat' + (t[3] && t[1] > 0 ? ' is-alert' : '') },
          h('div', { class: 'label', text: t[0] }), h('div', { class: 'num', text: t[1] }), h('div', { class: 'sub', text: t[2] }));
      })),
      h('div', { class: 'cols' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: staff ? 'Needs attention' : 'Waiting on you' })), attentionBody),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Recent activity' })), activityRows(recent))));
  }

  /* ================= ticket list ================= */
  var sorters = {
    updated: function (a, b) { return b.updated - a.updated; },
    created: function (a, b) { return b.created - a.created; },
    priority: function (a, b) {
      var d = PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority);
      return d || b.updated - a.updated;
    },
    due: function (a, b) {
      var ao = isActive(a) ? 0 : 1, bo = isActive(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return dueAt(a) - dueAt(b);
    }
  };

  function ticketsView(u) {
    var staff = isStaff(u);
    var results = h('div', { class: 'results' });

    function fill() {
      var query = ui.q.toLowerCase().trim();
      var list = visibleTickets().filter(function (t) {
        if (ui.status === 'active' && !isActive(t)) return false;
        if (ui.status !== 'all' && ui.status !== 'active' && t.status !== ui.status) return false;
        if (ui.priority !== 'all' && t.priority !== ui.priority) return false;
        if (staff) {
          if (ui.scope === 'mine' && t.assignee !== u.id) return false;
          if (ui.scope === 'unassigned' && (t.assignee || !isActive(t))) return false;
          if (ui.scope === 'overdue' && !isOverdue(t)) return false;
        }
        if (query) {
          var hay = (code(t) + ' ' + t.id + ' ' + t.title + ' ' + userName(t.requester)).toLowerCase();
          if (hay.indexOf(query) < 0) return false;
        }
        return true;
      });
      list.sort(sorters[ui.sort]);
      results.textContent = '';
      if (!list.length) {
        results.appendChild(h('div', { class: 'panel' }, h('p', { class: 'empty', text: 'No tickets match these filters.' })));
        return;
      }
      var head = ['ID', 'Ticket', 'Status', 'Priority'];
      if (staff) head.push('Requester');
      head.push('Assignee', 'SLA', 'Updated');
      var table = h('table', null,
        h('thead', null, h('tr', null, head.map(function (c) { return h('th', { text: c }); }))),
        h('tbody', null, list.map(function (t) {
          var d = dueInfo(t);
          return h('tr', { class: 'click p-' + slug(t.priority), onclick: function () { window.location.hash = 'ticket-' + t.id; } },
            h('td', null, h('a', { href: '#ticket-' + t.id, class: 'mono', text: code(t), onclick: function (e) { e.stopPropagation(); } })),
            h('td', { class: 'title-cell' }, h('div', null, h('a', { href: '#ticket-' + t.id, text: t.title, onclick: function (e) { e.stopPropagation(); } })),
              h('div', { class: 'sub', text: t.category })),
            h('td', null, statusPill(t.status)),
            h('td', null, prio(t.priority)),
            staff ? h('td', { text: userName(t.requester) }) : null,
            h('td', { class: t.assignee ? '' : 'muted', text: t.assignee ? userName(t.assignee) : 'Unassigned' }),
            h('td', { class: d.cls, text: d.text }),
            h('td', { class: 'muted', text: ago(t.updated) }));
        })));
      results.appendChild(h('div', { class: 'count-line', text: list.length + (list.length === 1 ? ' ticket' : ' tickets') }));
      results.appendChild(h('div', { class: 'table-wrap' }, table));
    }

    function opts(values, allLabel) {
      return [['all', allLabel]].concat(values.map(function (v) { return [v, v]; }));
    }
    var statusOpts = [['all', 'All statuses'], ['active', 'Active only']].concat(STATUSES.map(function (s) { return [s, s]; }));
    var filters = h('div', { class: 'filters' },
      h('div', { class: 'field grow' }, h('label', { for: 'f-q', text: 'Search' }),
        h('input', { type: 'search', id: 'f-q', placeholder: staff ? 'Title, ID or requester' : 'Title or ID', value: ui.q,
          oninput: function (e) { ui.q = e.target.value; fill(); } })),
      field('Status', select('f-status', statusOpts, ui.status, function (e) { ui.status = e.target.value; fill(); }), 'f-status'),
      field('Priority', select('f-priority', opts(PRIORITIES, 'All priorities'), ui.priority, function (e) { ui.priority = e.target.value; fill(); }), 'f-priority'),
      staff ? field('Show', select('f-scope', [['all', 'Everything'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned'], ['overdue', 'Overdue']], ui.scope,
        function (e) { ui.scope = e.target.value; fill(); }), 'f-scope') : null,
      field('Sort by', select('f-sort', [['updated', 'Recently updated'], ['created', 'Newest'], ['priority', 'Priority'], ['due', 'SLA due soonest']], ui.sort,
        function (e) { ui.sort = e.target.value; fill(); }), 'f-sort'));

    fill();
    return h('div', { class: 'main', style: { padding: '0' } },
      h('div', { class: 'page-head' },
        h('div', null, h('h1', { text: staff ? 'All tickets' : 'My tickets' }),
          h('p', { text: staff ? 'Every ticket in the desk. Click a row to open it.' : 'Tickets you have raised.' })),
        h('a', { class: 'btn btn-primary', href: '#new', text: 'New ticket' })),
      h('div', { class: 'panel' }, filters),
      results);
  }

  /* ================= new ticket ================= */
  function newView(u) {
    var staff = isStaff(u);
    var customers = db.users.filter(function (x) { return x.role === 'customer' && x.active; });
    var errs = {};
    var form = h('form', { class: 'panel form', novalidate: true });

    function draw(vals) {
      form.textContent = '';
      var titleIn = h('input', { type: 'text', id: 'n-title', maxlength: '120', value: vals.title, placeholder: 'Short summary of the problem' });
      var catIn = select('n-cat', CATEGORIES.map(function (c) { return [c, c]; }), vals.category);
      var priIn = select('n-pri', PRIORITIES.map(function (p) { return [p, p + ' (' + SLA_HOURS[p] + ' h target)']; }), vals.priority);
      var descIn = h('textarea', { id: 'n-desc', placeholder: 'What happened, what you expected, and anything you already tried', text: vals.description });
      var reqIn = staff ? select('n-req', customers.map(function (c) { return [String(c.id), c.name]; }), String(vals.requester)) : null;
      append(form, [
        field('Title', titleIn, 'n-title', vals.errors.title),
        h('div', { class: 'form-row' }, field('Category', catIn, 'n-cat'), field('Priority', priIn, 'n-pri')),
        staff ? field('Raise on behalf of', reqIn, 'n-req') : null,
        field('Description', descIn, 'n-desc', vals.errors.description),
        h('div', null, h('button', { class: 'btn btn-primary', type: 'submit', text: 'Submit ticket' }))
      ]);
      form.onsubmit = function (e) {
        e.preventDefault();
        var v = {
          title: titleIn.value.trim(), category: catIn.value, priority: priIn.value,
          description: descIn.value.trim(), requester: staff ? parseInt(reqIn.value, 10) : u.id, errors: {}
        };
        if (v.title.length < 6) v.errors.title = 'Give the ticket a title of at least 6 characters.';
        if (v.description.length < 15) v.errors.description = 'Describe the problem in at least 15 characters.';
        if (v.errors.title || v.errors.description) { draw(v); return; }
        var t = createTicket(v);
        toast(code(t) + ' created');
        window.location.hash = 'ticket-' + t.id;
      };
    }
    draw({ title: '', category: 'Technical', priority: 'Medium', description: '', requester: customers.length ? customers[0].id : u.id, errors: errs });

    return h('div', { class: 'main', style: { padding: '0' } },
      h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'New ticket' }),
        h('p', { text: 'Tell us what is wrong. The priority sets the response target.' }))),
      form);
  }

  /* ================= ticket detail ================= */
  function ticketView(u, t) {
    if (!t || !canView(u, t)) {
      return h('div', { class: 'panel' }, h('p', { class: 'empty', text: 'That ticket does not exist or you do not have access to it.' }),
        h('p', { style: { 'text-align': 'center' } }, h('a', { href: '#tickets', text: 'Back to tickets' })));
    }
    var staff = isStaff(u);
    var d = dueInfo(t);

    var track = h('ol', { class: 'track', 'aria-label': 'Workflow' }, STATUSES.map(function (s, i) {
      var cur = STATUSES.indexOf(t.status);
      return h('li', { class: i === cur ? 'current' : (i < cur ? 'done' : ''), text: s, 'aria-current': i === cur ? 'step' : null });
    }));

    var comments = t.comments.filter(function (c) { return staff || !c.internal; });
    var thread = comments.length ? h('div', { class: 'thread' }, comments.map(function (c) {
      var author = userById(c.author);
      return h('div', { class: 'msg' + (c.author === u.id ? ' mine' : '') + (c.internal ? ' note' : '') },
        h('span', { class: 'avatar', text: initials(author ? author.name : '?'), 'aria-hidden': 'true' }),
        h('div', { class: 'bubble' },
          h('div', { class: 'head' }, h('strong', { text: author ? author.name : 'Unknown' }), author ? roleBadge(author.role) : null,
            c.internal ? h('span', { class: 'role', text: 'Internal note' }) : null,
            h('span', { class: 'time', text: fullDate(c.at) })),
          h('div', { class: 'body', text: c.body })));
    })) : h('p', { class: 'muted', text: 'No replies yet.' });

    var draft = ui.drafts[t.id] || '';
    var replyBox = h('textarea', { id: 'reply', placeholder: staff ? 'Write a reply or an internal note' : 'Write a reply', text: draft,
      oninput: function (e) { ui.drafts[t.id] = e.target.value; } });
    var noteBox = staff ? h('input', { type: 'checkbox', id: 'is-note' }) : null;
    var sendBtn = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Send reply' });
    if (noteBox) noteBox.addEventListener('change', function () { sendBtn.textContent = noteBox.checked ? 'Add internal note' : 'Send reply'; });
    var replyForm = (!staff && t.status === 'Closed')
      ? h('p', { class: 'muted reply', text: 'This ticket is closed. Reopen it from the panel on the right to reply.' })
      : h('form', { class: 'reply', novalidate: true, onsubmit: function (e) {
          e.preventDefault();
          if (!replyBox.value.trim()) { toast('Write a message first'); return; }
          if (addComment(t, replyBox.value, noteBox && noteBox.checked)) {
            ui.drafts[t.id] = '';
            toast(noteBox && noteBox.checked ? 'Internal note added' : 'Reply sent');
            render();
          }
        } },
        h('label', { class: 'sr', for: 'reply', style: { position: 'absolute', left: '-9999px' }, text: 'Reply' }),
        replyBox,
        h('div', { class: 'reply-bar' },
          noteBox ? h('label', { class: 'check', for: 'is-note' }, noteBox, 'Internal note, hidden from the customer') : h('span'),
          sendBtn));

    // actions
    var next = allowedStatuses(u, t);
    var statusPanel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Workflow' }), statusPill(t.status)),
      next.length ? h('div', { class: 'actions' }, next.map(function (s) {
        return h('button', { class: 'btn btn-block', type: 'button', text: statusActionLabel(u, t, s), onclick: function () { changeStatus(t, s); } });
      })) : h('p', { class: 'muted', text: 'No actions available for you at this stage.' }));

    var manage = null;
    if (staff) {
      var assigneeOpts = [['', 'Unassigned']].concat(staffUsers().map(function (s) { return [String(s.id), s.name]; }));
      manage = h('section', { class: 'panel stack' },
        h('h2', { text: 'Manage' }),
        field('Priority', select('m-pri', PRIORITIES.map(function (p) { return [p, p]; }), t.priority, function (e) { setPriority(t, e.target.value); }), 'm-pri'),
        field('Assignee', select('m-asg', assigneeOpts, t.assignee ? String(t.assignee) : '', function (e) {
          setAssignee(t, e.target.value ? parseInt(e.target.value, 10) : null);
        }), 'm-asg'),
        (!t.assignee || t.assignee !== u.id) ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Assign to me', onclick: function () { setAssignee(t, u.id); } }) : null);
    }

    var info = h('section', { class: 'panel' }, h('h2', { text: 'Details' }),
      h('dl', { class: 'kv', style: { 'margin-top': '10px' } },
        h('dt', { text: 'Requester' }), h('dd', { text: userName(t.requester) }),
        h('dt', { text: 'Assignee' }), h('dd', { text: t.assignee ? userName(t.assignee) : 'Unassigned' }),
        h('dt', { text: 'Category' }), h('dd', { text: t.category }),
        h('dt', { text: 'Priority' }), h('dd', null, prio(t.priority)),
        h('dt', { text: 'Created' }), h('dd', { text: fullDate(t.created) }),
        h('dt', { text: 'SLA target' }), h('dd', null, fullDate(dueAt(t)), h('div', { class: d.cls + ' small', text: d.text })),
        t.resolvedAt ? h('dt', { text: 'Resolved' }) : null, t.resolvedAt ? h('dd', { text: fullDate(t.resolvedAt) }) : null));

    var hist = t.history.filter(function (e) { return staff || !e.internal; }).slice().sort(function (a, b) { return b.at - a.at; });
    var history = h('section', { class: 'panel' }, h('h2', { text: 'History' }),
      h('ul', { class: 'timeline', style: { 'margin-top': '12px' } }, hist.map(function (e) {
        return h('li', null, h('div', null, h('strong', { text: userName(e.by) }), ' ' + e.text.charAt(0).toLowerCase() + e.text.slice(1),
          h('span', { class: 'when', text: fullDate(e.at) })));
      })));

    var del = null;
    if (u.role === 'admin') {
      del = ui.confirmDelete === t.id
        ? h('div', { class: 'confirm' }, h('strong', { text: 'Delete ' + code(t) + '?' }), h('span', { class: 'small', text: 'This removes the ticket and its replies for everyone.' }),
            h('div', { class: 'btns' },
              h('button', { class: 'btn btn-solid-danger btn-sm', type: 'button', text: 'Delete ticket', onclick: function () {
                db.tickets = db.tickets.filter(function (x) { return x.id !== t.id; });
                ui.confirmDelete = null; save(); toast(code(t) + ' deleted'); window.location.hash = 'tickets';
              } }),
              h('button', { class: 'btn btn-sm', type: 'button', text: 'Cancel', onclick: function () { ui.confirmDelete = null; render(); } })))
        : h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Delete ticket', onclick: function () { ui.confirmDelete = t.id; render(); } });
    }

    return h('div', { class: 'main', style: { padding: '0' } },
      h('a', { class: 'back', href: '#tickets', text: '← ' + (staff ? 'All tickets' : 'My tickets') }),
      h('div', { class: 'detail-head' },
        h('h1', { text: t.title }),
        h('div', { class: 'detail-meta' }, h('span', { class: 'mono', text: code(t) }), statusPill(t.status), prio(t.priority),
          h('span', { text: 'Raised by ' + userName(t.requester) + ', ' + ago(t.created) }))),
      track,
      h('div', { class: 'workspace' },
        h('div', { class: 'stack' },
          h('section', { class: 'panel' }, h('h2', { text: 'Description', style: { 'margin-bottom': '8px' } }), h('p', { class: 'desc', text: t.description })),
          h('section', { class: 'panel' }, h('h2', { text: 'Conversation', style: { 'margin-bottom': '12px' } }), thread, replyForm)),
        h('div', { class: 'stack' }, statusPanel, manage, info, history, del)));
  }

  /* ================= reports ================= */
  function barList(items, total) {
    return h('div', { class: 'bars' }, items.map(function (it) {
      var pct = total ? Math.round((it.count / total) * 100) : 0;
      return h('div', { class: 'bar-row' },
        h('span', { class: 'name', text: it.label }),
        h('div', { class: 'bar', role: 'img', 'aria-label': it.label + ': ' + it.count }, h('i', { style: { width: pct + '%', '--bar': it.color || 'var(--accent)' } })),
        h('span', { class: 'val', text: it.count }));
    }));
  }

  function reportsView(u) {
    var ts = visibleTickets();
    var resolved = ts.filter(function (t) { return t.resolvedAt; });
    var totalHrs = resolved.reduce(function (s, t) { return s + (t.resolvedAt - t.created) / HOUR; }, 0);
    var avg = resolved.length ? totalHrs / resolved.length : 0;
    var met = resolved.filter(function (t) { return (t.resolvedAt - t.created) <= SLA_HOURS[t.priority] * HOUR; }).length;
    var metPct = resolved.length ? Math.round((met / resolved.length) * 100) : 0;
    var active = ts.filter(isActive);

    var tiles = [
      ['Total tickets', ts.length, 'all time'],
      ['Active', active.length, 'not yet resolved'],
      ['Avg resolution', resolved.length ? avg.toFixed(1) + ' h' : '—', 'from creation to resolved'],
      ['Met SLA', resolved.length ? metPct + '%' : '—', met + ' of ' + resolved.length + ' resolved']
    ];

    var statusItems = STATUSES.map(function (s) {
      return { label: s, count: ts.filter(function (t) { return t.status === s; }).length, color: 'var(--s-' + slug(s) + ')' };
    });
    var prioItems = PRIORITIES.slice().reverse().map(function (p) {
      return { label: p, count: active.filter(function (t) { return t.priority === p; }).length, color: 'var(--p-' + slug(p) + ')' };
    });
    var catItems = CATEGORIES.map(function (c) {
      return { label: c, count: ts.filter(function (t) { return t.category === c; }).length };
    });

    var agentRows = staffUsers().map(function (s) {
      var mine = ts.filter(function (t) { return t.assignee === s.id; });
      var done = mine.filter(function (t) { return t.resolvedAt; });
      var avgA = done.length ? done.reduce(function (a, t) { return a + (t.resolvedAt - t.created) / HOUR; }, 0) / done.length : null;
      return h('tr', null,
        h('td', null, h('strong', { text: s.name }), ' ', roleBadge(s.role)),
        h('td', { class: 'num', text: mine.filter(isActive).length }),
        h('td', { class: 'num', text: mine.filter(isOverdue).length }),
        h('td', { class: 'num', text: done.length }),
        h('td', { class: 'num', text: avgA === null ? '—' : avgA.toFixed(1) + ' h' }));
    });
    var unassigned = active.filter(function (t) { return !t.assignee; }).length;

    return h('div', { class: 'main', style: { padding: '0' } },
      h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Reports' }), h('p', { text: 'Status, workload and service-level performance across the desk.' }))),
      h('div', { class: 'stats' }, tiles.map(function (t) {
        return h('div', { class: 'stat' }, h('div', { class: 'label', text: t[0] }), h('div', { class: 'num', text: t[1] }), h('div', { class: 'sub', text: t[2] }));
      })),
      h('div', { class: 'cols' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Tickets by status' })), barList(statusItems, ts.length)),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Active tickets by priority' })), barList(prioItems, active.length)),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Tickets by category' })), barList(catItems, ts.length))),
      h('section', null,
        h('div', { class: 'panel-head' }, h('h2', { text: 'Agent workload' }), h('span', { class: 'muted small', text: unassigned + ' active ticket' + (unassigned === 1 ? '' : 's') + ' unassigned' })),
        h('div', { class: 'table-wrap' }, h('table', { style: { 'min-width': '560px' } },
          h('thead', null, h('tr', null, h('th', { text: 'Agent' }), h('th', { class: 'num', text: 'Active' }), h('th', { class: 'num', text: 'Overdue' }),
            h('th', { class: 'num', text: 'Resolved' }), h('th', { class: 'num', text: 'Avg resolution' }))),
          h('tbody', null, agentRows)))));
  }

  /* ================= users (admin) ================= */
  function usersView(u) {
    var errBox = h('span', { class: 'err small', style: { color: 'var(--danger)' } });
    var nameIn = h('input', { type: 'text', id: 'u-name', placeholder: 'Full name' });
    var mailIn = h('input', { type: 'email', id: 'u-mail', placeholder: 'name@company.example' });
    var roleIn = select('u-role', [['customer', 'Customer'], ['agent', 'Agent'], ['admin', 'Admin']], 'customer');
    var addForm = h('form', { class: 'filters', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var name = nameIn.value.trim(), mail = mailIn.value.trim();
      if (name.length < 2 || mail.indexOf('@') < 1) { errBox.textContent = 'Enter a name and a valid email address.'; return; }
      db.users.push({ id: db.nextUserId++, name: name, email: mail, role: roleIn.value, active: true });
      save(); toast(name + ' added'); render();
    } },
      field('Name', nameIn, 'u-name'), field('Email', mailIn, 'u-mail'), field('Role', roleIn, 'u-role'),
      h('div', { class: 'field' }, h('label', { text: ' ' }), h('button', { class: 'btn btn-primary', type: 'submit', text: 'Add user' })), errBox);

    var rows = db.users.map(function (x) {
      var self = x.id === u.id;
      var count = db.tickets.filter(function (t) { return t.requester === x.id || t.assignee === x.id; }).length;
      var roleSel = select('role-' + x.id, [['customer', 'Customer'], ['agent', 'Agent'], ['admin', 'Admin']], x.role, function (e) {
        x.role = e.target.value; save(); toast(x.name + ' is now ' + ROLE_LABEL[x.role]); render();
      });
      if (self) roleSel.disabled = true;
      return h('tr', null,
        h('td', null, h('strong', { text: x.name }), self ? h('span', { class: 'muted', text: ' (you)' }) : null, h('div', { class: 'muted small', text: x.email })),
        h('td', null, roleSel),
        h('td', null, x.active ? h('span', { class: 'pill s-resolved', text: 'Active' }) : h('span', { class: 'pill s-closed', text: 'Disabled' })),
        h('td', { class: 'num', text: count }),
        h('td', null, h('button', { class: 'btn btn-sm', type: 'button', disabled: self, text: x.active ? 'Disable' : 'Enable', onclick: function () {
          x.active = !x.active; save(); toast(x.name + (x.active ? ' enabled' : ' disabled')); render();
        } })));
    });

    var reset = ui.confirmReset
      ? h('div', { class: 'confirm' }, h('strong', { text: 'Reset all demo data?' }), h('span', { class: 'small', text: 'Tickets, users and replies return to the starting set.' }),
          h('div', { class: 'btns' },
            h('button', { class: 'btn btn-solid-danger btn-sm', type: 'button', text: 'Reset data', onclick: function () {
              db = seedData(); save(); ui.confirmReset = false; sessionId = 1; lsSet(SESSION_KEY, '1'); toast('Demo data restored'); render();
            } }),
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Cancel', onclick: function () { ui.confirmReset = false; render(); } })))
      : h('div', null, h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Reset demo data', onclick: function () { ui.confirmReset = true; render(); } }));

    return h('div', { class: 'main', style: { padding: '0' } },
      h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Users' }), h('p', { text: 'Control who can sign in and what they can do.' }))),
      h('div', { class: 'panel' }, h('h2', { text: 'Add a user', style: { 'margin-bottom': '10px' } }), addForm),
      h('div', { class: 'table-wrap' }, h('table', { style: { 'min-width': '620px' } },
        h('thead', null, h('tr', null, h('th', { text: 'User' }), h('th', { text: 'Role' }), h('th', { text: 'Status' }), h('th', { class: 'num', text: 'Tickets' }), h('th', { text: '' }))),
        h('tbody', null, rows))),
      reset);
  }

  /* ================= activity (admin) ================= */
  function activityView() {
    var items = collectActivity(db.tickets, true).slice(0, 60);
    return h('div', { class: 'main', style: { padding: '0' } },
      h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Activity log' }), h('p', { text: 'The latest 60 events across all tickets, including internal notes.' }))),
      h('section', { class: 'panel' }, activityRows(items)));
  }

  /* ================= boot ================= */
  load();
  var saved = lsGet(SESSION_KEY);
  if (saved) {
    var su = userById(parseInt(saved, 10));
    if (su && su.active) sessionId = su.id;
  }
  window.addEventListener('hashchange', render);
  render();
})();
