# Relay Desk: Role-Based Online Ticket System

A web-based support desk that keeps tickets, conversations, workflow and status reporting in one place. Customers raise and follow tickets, agents work the queue, and admins manage users and review everything.

Built with **HTML, external CSS and plain JavaScript**. There is no backend and no build step.

> Project name: Relay Desk  
> Team name: _<add team name>_  
> Course code: _<add course code>_  
> Live demo: _<add GitHub Pages link>_  
> Video presentation: _<add video link>_

## 1. Problem statement

Support requests get lost across email threads and chat messages. Nobody can say who owns a request, what state it is in, or whether it is late. Relay Desk centralises:

| Need | How Relay Desk covers it |
| --- | --- |
| Core records | Every ticket stores title, description, category, priority, requester, assignee, timestamps, replies and a full history |
| User interactions | Threaded conversation on each ticket, with staff-only internal notes |
| Workflows | Open, In Progress, On Hold, Resolved, Closed, with moves limited by role |
| Status reporting | Overview tiles plus a Reports page: status, priority and category counts, average resolution time, SLA compliance, agent workload |

## 2. Roles and permissions

| Capability | Customer | Agent | Admin |
| --- | :---: | :---: | :---: |
| Raise a ticket | yes | yes (on behalf of a customer) | yes |
| See tickets | own only | all | all |
| Reply to a ticket | yes | yes | yes |
| Add internal notes | no | yes | yes |
| Change status | reopen, close own resolved ticket, withdraw own open ticket | any status | any status |
| Change priority, assign tickets | no | yes | yes |
| View reports | no | yes | yes |
| Manage users and roles | no | no | yes |
| Delete tickets, view activity log | no | no | yes |

Permissions are enforced in the code that changes data (`allowedStatuses`, `setAssignee`, `setPriority`, `addComment`) and in the routing, so hiding a button is not the only protection.

### Workflow rules

- Moving a ticket to In Progress or Resolved assigns it to the acting staff member if nobody owns it.
- A customer reply on a Resolved ticket reopens it. A customer reply on an On Hold ticket resumes it.
- Every change is written to the ticket history. Internal notes are hidden from customers, including in the history.
- SLA targets by priority: Urgent 4 h, High 8 h, Medium 24 h, Low 72 h. The clock pauses while a ticket is On Hold.

## 3. Demo accounts

Sign-in is a demo account picker so evaluators can see each role at once.

| Role | Accounts |
| --- | --- |
| Customer | Rohit Verma, Priya Nair, Dev Patel |
| Agent | Arjun Rao, Sana Khan |
| Admin | Meera Iyer |

The app starts with 12 sample tickets. **Users, then Reset demo data** restores the starting set.

## 4. Technology

- HTML5 for structure
- CSS3 in `css/style.css` (design tokens, grid and flexbox, light and dark themes, responsive down to phone width)
- JavaScript (ES5 style, no libraries) in `js/app.js`
- `localStorage` for persistence, with an in-memory fallback if storage is blocked
- Google Fonts (IBM Plex Sans and Mono)

## 5. Project structure

```
relay-desk/
  index.html        page shell and script and style links
  css/style.css     all styling, driven by CSS variables
  js/app.js         data, business rules, routing and views
  README.md
```

Inside `js/app.js` the code is grouped in this order: constants, storage, seed data, helpers, domain rules (permissions and workflow), view helpers, routing and shell, then one function per page (login, dashboard, ticket list, new ticket, ticket detail, reports, users, activity).

## 6. Run it locally

Open `index.html` in a browser. No server is needed.

## 7. Deploy on GitHub Pages

1. Create a new public repository on GitHub, for example `relay-desk`.
2. Upload these files, keeping the folder layout. `index.html` must be in the repository root.
3. Open **Settings, then Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/relay-desk/`.
5. Open the link in a private window to confirm the evaluator can reach it.

Vercel and Netlify also work: import the repository, leave the build command empty and set the publish directory to the root.

## 8. Known limits

- Data lives in each browser. Two people do not see each other's changes.
- Sign-in is a demo picker, not real authentication.
- There is no email notification or file attachment support.

A production version would add a backend and database, real authentication and server-side permission checks.

## 9. Team contributions

Fill this in so each member can speak to their own part in the viva.

| Member | Registration number | Contribution |
| --- | --- | --- |
| _<name>_ | _<reg no>_ | _<for example: login and role permissions>_ |
| _<name>_ | _<reg no>_ | _<for example: ticket detail and workflow>_ |
| _<name>_ | _<reg no>_ | _<for example: reports and styling>_ |

## 10. Video outline (about 5 minutes)

1. Introduce the team and the problem statement.
2. Why a central ticket desk matters.
3. The solution and its objectives.
4. Walk through features as a customer, then an agent, then an admin.
5. Technologies used.
6. Outcomes, limits and next steps.
7. Each member states their contribution. Every member speaks.

## 11. Viva preparation

Be ready to explain, and to change live:

- How `allowedStatuses` decides which status buttons a role sees.
- Where tickets are saved and what happens when `localStorage` is unavailable.
- How the SLA due time and the overdue check are calculated (`dueAt`, `isOverdue`).
- How the hash router chooses a page and blocks pages a role should not see.
- How the Reports numbers are computed from the ticket list.
- Why every value is added with `textContent` rather than `innerHTML`.
