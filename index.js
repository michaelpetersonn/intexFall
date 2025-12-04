// index.js - Ella Rises simple app
require('dotenv').config();
const express = require('express');
const db = require('./db');

const session = require('express-session');

const app = express();
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ella-rises-secret',
    resave: false,
    saveUninitialized: true,
  })
);

// ---------- Helpers ----------
function requireLogin(req, res, next) {
  // Accept credentials from query string or session
  const userId = req.query.userId || req.session.userId;
  const level = req.query.level || req.session.level;
  if (!userId || !level) {
    return res.redirect('/login');
  }
  req.userId = userId;
  req.level = level;
  next();
}

function isManager(level) {
  return level === 'M';
}

// Preserve user info when redirecting
function redirectWithUser(res, path, userId, level) {
  res.redirect(
    `${path}?userId=${encodeURIComponent(userId)}&level=${encodeURIComponent(
      level
    )}`
  );
}

// ---------- Login ----------
// users(participant_email, password, user_level)

// GET /login – show login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login – check users table (using knex via db.query)
app.post('/login', async (req, res) => {
  const { username, password } = req.body; // email/login

  try {
    const result = await db.query(
      `
      SELECT *
      FROM users
      WHERE participant_email = ?
        AND password = ?
      `,
      [username, password]
    );

    const rows = result.rows || [];

    if (rows.length === 0) {
      return res
        .status(401)
        .render('login', { error: 'Invalid email or password' });
    }

    const user = rows[0];

    const userId = user.participant_email;
    const level =
      user.user_level || // from your schema
      user.level ||
      user.userrole ||
      'U';

    // Persist in session
    req.session.userId = userId;
    req.session.level = level;

    res.redirect(
      `/landing?userId=${encodeURIComponent(userId)}&level=${level}`
    );
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).render('login', { error: 'Server error' });
  }
});


app.get('/dbtest', async (req, res) => {
  try {
    const info = await db.query('SELECT current_database(), current_user');
    const tables = await db.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    res.json({
      currentDatabase: info.rows[0].current_database,
      currentUser: info.rows[0].current_user,
      publicTables: tables.rows.map(r => r.table_name),
    });
  } catch (err) {
    console.error('DB TEST ERROR:', err);
    res.status(500).send(err.toString());
  }
});





// ---------- LOGOUT ----------
app.get('/logout', (req, res) => {
  req.session.destroy(() => {});
  // Just redirect them to landing WITHOUT userId/level
  return res.redirect('/landing');
});

// ---------- Landing / dashboard ----------

app.get('/landing', async (req, res) => {
  // Prefer query params; fall back to session
  const userId = req.query.userId || req.session.userId || null;
  const level = req.query.level || req.session.level || null;

  try {
    const [participants, events, donations, surveys] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM participant'),
      db.query('SELECT COUNT(*) AS count FROM event'),
      db.query('SELECT COALESCE(SUM(donation_amount),0) AS total FROM donation'),
      db.query('SELECT COUNT(*) AS count FROM registration'),
    ]);

    res.render('landing', {
      loggedInUserId: userId,
      loggedInLevel: level,
      stats: {
        participants: participants.rows[0].count,
        events: events.rows[0].count,
        donationsTotal: donations.rows[0].total,
        surveys: surveys.rows[0].count,
      },
    });
  } catch (err) {
    console.error('Dashboard error', err);
    res.render('landing', {
      loggedInUserId: userId,
      loggedInLevel: level,
      stats: { participants: 0, events: 0, donationsTotal: 0, surveys: 0 },
    });
  }
});

// ---------- SITE USERS (MANAGER ONLY)----------------
app.get('/users', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can manage website users.');
  }

  const q = req.query.q;
  let sql = `
    SELECT participant_email, password, user_level
    FROM users
  `;
  const params = [];

  if (q) {
    sql += ' WHERE participant_email ILIKE ? OR user_level ILIKE ?';
    const like = '%' + q + '%';
    params.push(like, like);
  }

  sql += ' ORDER BY participant_email';

  try {
    const result = await db.query(sql, params);

    // 🔑 Normalize result to always be an array
    let rows;
    if (Array.isArray(result)) {
      rows = result;
    } else if (Array.isArray(result.rows)) {
      rows = result.rows;
    } else {
      rows = []; // fallback
    }

    res.render('users', {
      loggedInUserId: userId,
      loggedInLevel: level,
      users: rows,
      search: q || '',
      error: null,                         // always defined
    });
  } catch (err) {
    console.error('Users list error', err);
    res.render('users', {
      loggedInUserId: userId,
      loggedInLevel: level,
      users: [],
      search: q || '',
      error: 'There was a problem loading users.',
    });
  }
});

// Add user – manager only
app.post('/users/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can add website users.');
  }

  const { participant_email, password, user_level } = req.body;
  console.log('ADD USER body:', req.body);

  try {
    // 1) Check if participant exists
    const pResult = await db.query(
      'SELECT participant_email FROM participant WHERE participant_email = ?',
      [participant_email]
    );

    // 🔑 Normalize participants array safely
    let participants;
    if (Array.isArray(pResult)) {
      participants = pResult;
    } else if (Array.isArray(pResult.rows)) {
      participants = pResult.rows;
    } else {
      participants = [];
    }

    console.log('PARTICIPANT CHECK:', participants);

    if (participants.length === 0) {
      console.log('*** NO PARTICIPANT FOUND FOR', participant_email, '***');

      // Reload users list so the table still shows
      const uResult = await db.query(
        'SELECT participant_email, password, user_level FROM users ORDER BY participant_email'
      );

      let users;
      if (Array.isArray(uResult)) {
        users = uResult;
      } else if (Array.isArray(uResult.rows)) {
        users = uResult.rows;
      } else {
        users = [];
      }

      return res.render('users', {
        loggedInUserId: userId,
        loggedInLevel: level,
        users,
        search: '',
        error: `No participant found with email: ${participant_email}. Create the participant first.`,
      });
    }

    // 2) Participant exists → insert into users
    await db.query(
      `
      INSERT INTO users (participant_email, password, user_level)
      VALUES (?, ?, ?)
      `,
      [participant_email, password, user_level]
    );

    redirectWithUser(res, '/users', userId, level);
  } catch (err) {
    console.error('Add user error:', err);

    // Try to re-render Users page with a generic error
    try {
      const uResult = await db.query(
        'SELECT participant_email, password, user_level FROM users ORDER BY participant_email'
      );

      let users;
      if (Array.isArray(uResult)) {
        users = uResult;
      } else if (Array.isArray(uResult.rows)) {
        users = uResult.rows;
      } else {
        users = [];
      }

      return res.render('users', {
        loggedInUserId: userId,
        loggedInLevel: level,
        users,
        search: '',
        error: 'There was a problem adding the user. Please try again.',
      });
    } catch (inner) {
      console.error('Users reload after add error:', inner);
      return redirectWithUser(res, '/users', userId, level);
    }
  }
});

// Edit user – manager only (email is the key)
app.post('/users/edit/:participant_email', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can edit website users.');
  }

  const { participant_email } = req.params;
  const { password, user_level } = req.body;
  console.log('EDIT USER params:', participant_email);
  console.log('EDIT USER body:', req.body);

  try {
    await db.query(
      `
      UPDATE users
      SET password = ?, user_level = ?
      WHERE participant_email = ?
      `,
      [password, user_level, participant_email]
    );
    redirectWithUser(res, '/users', userId, level);
  } catch (err) {
    console.error('Edit user error:', err);
    redirectWithUser(res, '/users', userId, level);
  }
});

// Delete user – manager only
app.post('/users/delete/:participant_email', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can delete website users.');
  }

  const { participant_email } = req.params;
  console.log('DELETE USER:', participant_email);

  try {
    await db.query(
      'DELETE FROM users WHERE participant_email = ?',
      [participant_email]
    );
    redirectWithUser(res, '/users', userId, level);
  } catch (err) {
    console.error('Delete user error:', err);
    redirectWithUser(res, '/users', userId, level);
  }
});

// ---------- Participants ----------
// participant(participant_email, participant_first_name, participant_last_name, ...)

// GET /participants – list & optional search
app.get('/participants', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || null; // null = not logged in
  const q = req.query.q;

  // Choose columns based on role
  let sql;
  if (level === 'M') {
    // Manager: see everything
    sql = `
      SELECT participant_email,
             participant_first_name,
             participant_last_name,
             participant_dob,
             participant_role,
             participant_phone,
             participant_city,
             participant_state,
             participant_zip,
             participant_school_or_employer,
             participant_field_of_interest,
             total_donations
      FROM participant
    `;
  } else {
    // User (or not logged in): limited view
    sql = `
      SELECT participant_email,
             participant_first_name,
             participant_last_name,
             participant_role,
             participant_field_of_interest
      FROM participant
    `;
  }

  const params = [];
  if (q) {
    sql += `
      WHERE participant_first_name ILIKE ?
         OR participant_last_name  ILIKE ?
         OR participant_email      ILIKE ?
    `;
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  sql += ' ORDER BY participant_last_name, participant_first_name';

  try {
    const result = await db.query(sql, params);
    const rows = result.rows || result;

    res.render('participants', {
      loggedInUserId: userId,
      loggedInLevel: level,
      participants: rows,
      search: q || '',
    });
  } catch (err) {
    console.error('Participants error', err);
    res.render('participants', {
      loggedInUserId: userId,
      loggedInLevel: level,
      participants: [],
      search: q || '',
    });
  }
});

// Add participant – manager only
app.post('/participants/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can add participants.');

  const {
    participant_email,
    participant_first_name,
    participant_last_name,
    participant_role,
    participant_field_of_interest,
  } = req.body;

  try {
    await db.query(
      `
      INSERT INTO participant (
        participant_email,
        participant_first_name,
        participant_last_name,
        participant_role,
        participant_field_of_interest
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        participant_email,
        participant_first_name,
        participant_last_name,
        participant_role || null,
        participant_field_of_interest || null,
      ]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Add participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// Edit participant – manager only (email is key)
app.post('/participants/edit/:participant_email', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can edit participants.');

  const { participant_email } = req.params;
  const {
    participant_first_name,
    participant_last_name,
    participant_role,
    participant_field_of_interest,
  } = req.body;

  try {
    await db.query(
      `
      UPDATE participant
      SET participant_first_name       = ?,
          participant_last_name        = ?,
          participant_role             = ?,
          participant_field_of_interest = ?
      WHERE participant_email          = ?
      `,
      [
        participant_first_name,
        participant_last_name,
        participant_role || null,
        participant_field_of_interest || null,
        participant_email,
      ]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Edit participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// Delete participant – manager only
app.post('/participants/delete/:participant_email', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can delete participants.');

  const { participant_email } = req.params;

  try {
    await db.query(
      'DELETE FROM participant WHERE participant_email = ?',
      [participant_email]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Delete participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// ---------- Events ----------
// event(event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)

// ---------- Events ----------
// event(event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)
// event_instance(event_instance_id, event_name, event_datetime_start, event_datetime_end,
//                event_location, event_capacity, event_registration_deadline)

// List events + event instances (users see future; managers see all)
app.get('/events', async (req, res) => {
  const userId = req.query.userId || req.session.userId || null;
  const level = req.query.level || req.session.level || 'U';
  const q = req.query.q;
  const userIsManager = isManager(level);

  try {
    let eventInstances = [];
    let events = [];
    let myRegistrations = [];
    let myInstanceIds = [];

    if (userIsManager) {
      // Manager: show all instances (past + future) and event definitions
      let instanceSql = `
        SELECT ei.event_instance_id,
               ei.event_name,
               e.event_type,
               e.event_description,
               ei.event_datetime_start,
               ei.event_datetime_end,
               ei.event_location,
               ei.event_capacity,
               ei.event_registration_deadline
        FROM event_instance ei
        JOIN event e ON e.event_name = ei.event_name
      `;
      const instanceParams = [];
      const whereParts = [];

      if (q) {
        whereParts.push(`
          (
            ei.event_name ILIKE ?
            OR e.event_type ILIKE ?
            OR e.event_description ILIKE ?
            OR ei.event_location ILIKE ?
          )
        `);
        const like = '%' + q + '%';
        instanceParams.push(like, like, like, like);
      }

      if (whereParts.length > 0) {
        instanceSql += ' WHERE ' + whereParts.join(' AND ');
      }

      instanceSql += ' ORDER BY ei.event_datetime_start';

      const eventsSql = `
        SELECT event_name,
               event_type,
               event_description,
               event_recurrence_pattern,
               event_default_capacity
        FROM event
        ORDER BY event_name
      `;

      const [instancesResult, eventsResult] = await Promise.all([
        db.query(instanceSql, instanceParams),
        db.query(eventsSql, []),
      ]);

      eventInstances = instancesResult.rows || instancesResult;
      events = eventsResult.rows || eventsResult;
    } else {
      // User: show only their past events
      if (userId) {
        const myRegsSql = `
          SELECT r.event_instance_id,
                 ei.event_name,
                 e.event_type,
                 e.event_description,
                 ei.event_datetime_start,
                 ei.event_datetime_end,
                 ei.event_location
          FROM registration r
          JOIN event_instance ei ON ei.event_instance_id = r.event_instance_id
          JOIN event e ON e.event_name = ei.event_name
          WHERE r.participant_email = ?
            AND ei.event_datetime_start < NOW()
          ORDER BY ei.event_datetime_start DESC
        `;
        const myRegsResult = await db.query(myRegsSql, [userId]);
        myRegistrations = myRegsResult.rows || myRegsResult;
        myInstanceIds = myRegistrations.map(r => r.event_instance_id);
      }
    }

    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      eventInstances,
      events,
      search: q || '',
      myRegistrations,
      myInstanceIds,
    });
  } catch (err) {
    console.error('Events error', err);
    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      eventInstances: [],
      events: [],
      search: q || '',
      myRegistrations: [],
      myInstanceIds: [],
    });
  }
});

// Add event – manager only (parent "event" table)
app.post('/events/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can add events.');

  const {
    event_name,
    event_type,
    event_description,
    event_recurrence_pattern,
    event_default_capacity,
  } = req.body;

  try {
    await db.query(
      `INSERT INTO event
         (event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)
       VALUES (?,?,?,?,?)`,
      [
        event_name,
        event_type || null,
        event_description || null,
        event_recurrence_pattern || null,
        event_default_capacity || null,
      ]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Add event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Edit event – manager only (parent "event" table)
app.post('/events/edit/:event_name', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can edit events.');

  const { event_name } = req.params;
  const {
    event_type,
    event_description,
    event_recurrence_pattern,
    event_default_capacity,
  } = req.body;

  try {
    await db.query(
      `UPDATE event
         SET event_type = ?,
             event_description = ?,
             event_recurrence_pattern = ?,
             event_default_capacity = ?
       WHERE event_name = ?`,
      [
        event_type || null,
        event_description || null,
        event_recurrence_pattern || null,
        event_default_capacity || null,
        event_name,
      ]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Edit event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Delete event – manager only (parent "event" table)
app.post('/events/delete/:event_name', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can delete events.');

  const { event_name } = req.params;

  try {
    await db.query('DELETE FROM event WHERE event_name = ?', [event_name]);
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Delete event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// ---------- Events ----------
// event(event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)
// event_instance(event_instance_id, event_name, event_datetime_start, event_datetime_end,
//                event_location, event_capacity, event_registration_deadline)

// List events + event instances
app.get('/events', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  // Event instances joined to parent event
  let instanceSql = `
    SELECT ei.event_instance_id,
           ei.event_name,
           e.event_type,
           e.event_description,
           ei.event_datetime_start,
           ei.event_datetime_end,
           ei.event_location,
           ei.event_capacity,
           ei.event_registration_deadline
    FROM event_instance ei
    JOIN event e ON e.event_name = ei.event_name
  `;
  const instanceParams = [];

  if (q) {
    instanceSql += `
      WHERE ei.event_name ILIKE ?
         OR e.event_type ILIKE ?
         OR e.event_description ILIKE ?
         OR ei.event_location ILIKE ?
    `;
    const like = '%' + q + '%';
    instanceParams.push(like, like, like, like);
  }

  instanceSql += ' ORDER BY ei.event_datetime_start';

  const eventsSql = `
    SELECT event_name,
           event_type,
           event_description,
           event_recurrence_pattern,
           event_default_capacity
    FROM event
    ORDER BY event_name
  `;

  let myRegsSql = null;
  const promises = [
    db.query(instanceSql, instanceParams),
    db.query(eventsSql, []),
  ];

  if (userId) {
    myRegsSql = `
      SELECT r.event_instance_id,
             ei.event_name,
             e.event_type,
             e.event_description,
             ei.event_datetime_start,
             ei.event_datetime_end,
             ei.event_location
      FROM registration r
      JOIN event_instance ei ON ei.event_instance_id = r.event_instance_id
      JOIN event e ON e.event_name = ei.event_name
      WHERE r.participant_email = ?
      ORDER BY ei.event_datetime_start
    `;
    promises.push(db.query(myRegsSql, [userId]));
  }

  try {
    const results = await Promise.all(promises);
    const instances = results[0].rows;
    const events = results[1].rows;
    const myRegs = userId ? results[2].rows : [];
    const myInstanceIds = myRegs.map(r => r.event_instance_id);

    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      eventInstances: instances,
      events: events,
      search: q || '',
      myRegistrations: myRegs,
      myInstanceIds,
    });
  } catch (err) {
    console.error('Events error', err);
    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      eventInstances: [],
      events: [],
      search: q || '',
      myRegistrations: [],
      myInstanceIds: [],
    });
  }
});

// Add event – manager only (parent "event" table)
app.post('/events/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can add events.');

  const {
    event_name,
    event_type,
    event_description,
    event_recurrence_pattern,
    event_default_capacity,
  } = req.body;

  try {
    await db.query(
      `INSERT INTO event
         (event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)
       VALUES (?,?,?,?,?)`,
      [
        event_name,
        event_type || null,
        event_description || null,
        event_recurrence_pattern || null,
        event_default_capacity || null,
      ]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Add event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Edit event – manager only (parent "event" table)
app.post('/events/edit/:event_name', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can edit events.');

  const { event_name } = req.params;
  const {
    event_type,
    event_description,
    event_recurrence_pattern,
    event_default_capacity,
  } = req.body;

  try {
    await db.query(
      `UPDATE event
         SET event_type = ?,
             event_description = ?,
             event_recurrence_pattern = ?,
             event_default_capacity = ?
       WHERE event_name = ?`,
      [
        event_type || null,
        event_description || null,
        event_recurrence_pattern || null,
        event_default_capacity || null,
        event_name,
      ]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Edit event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Delete event – manager only (parent "event" table)
app.post('/events/delete/:event_name', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can delete events.');

  const { event_name } = req.params;

  try {
    await db.query('DELETE FROM event WHERE event_name = ?', [event_name]);
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Delete event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});
// ---------- Events ----------
// event(event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)
// event_instance(event_instance_id, event_name, event_datetime_start, event_datetime_end,
//                event_location, event_capacity, event_registration_deadline)

// List upcoming events + instances
app.get('/events', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  // --- UPCOMING EVENT INSTANCES (ONLY FUTURE) ---
  let instanceSql = `
    SELECT ei.event_instance_id,
           ei.event_name,
           e.event_type,
           e.event_description,
           ei.event_datetime_start,
           ei.event_datetime_end,
           ei.event_location,
           ei.event_capacity,
           ei.event_registration_deadline
    FROM event_instance ei
    JOIN event e ON e.event_name = ei.event_name
  `;
  const instanceParams = [];
  const whereParts = ['ei.event_datetime_start >= NOW()']; // only future

  if (q) {
    whereParts.push(`
      (
        ei.event_name ILIKE ?
        OR e.event_type ILIKE ?
        OR e.event_description ILIKE ?
        OR ei.event_location ILIKE ?
      )
    `);
    const like = '%' + q + '%';
    instanceParams.push(like, like, like, like);
  }

  if (whereParts.length > 0) {
    instanceSql += ' WHERE ' + whereParts.join(' AND ');
  }

  instanceSql += ' ORDER BY ei.event_datetime_start';

  // --- PARENT EVENTS (for manager CRUD) ---
  const eventsSql = `
    SELECT event_name,
           event_type,
           event_description,
           event_recurrence_pattern,
           event_default_capacity
    FROM event
    ORDER BY event_name
  `;

  // --- USER'S OWN REGISTRATIONS (also only future) ---
  const promises = [
    db.query(instanceSql, instanceParams),
    db.query(eventsSql, []),
  ];

  if (userId) {
    const myRegsSql = `
      SELECT r.event_instance_id,
             ei.event_name,
             e.event_type,
             e.event_description,
             ei.event_datetime_start,
             ei.event_datetime_end,
             ei.event_location
      FROM registration r
      JOIN event_instance ei ON ei.event_instance_id = r.event_instance_id
      JOIN event e ON e.event_name = ei.event_name
      WHERE r.participant_email = ?
        AND ei.event_datetime_start >= NOW()
      ORDER BY ei.event_datetime_start
    `;
    promises.push(db.query(myRegsSql, [userId]));
  }

  try {
    const results = await Promise.all(promises);

    const instancesResult = results[0];
    const eventsResult = results[1];

    const eventInstances = instancesResult.rows || instancesResult;
    const events = eventsResult.rows || eventsResult;

    let myRegistrations = [];
    let myInstanceIds = [];

    if (userId && results[2]) {
      const myRegsResult = results[2];
      myRegistrations = myRegsResult.rows || myRegsResult;
      myInstanceIds = myRegistrations.map(r => r.event_instance_id);
    }

    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      eventInstances,
      events,
      search: q || '',
      myRegistrations,
      myInstanceIds,
    });
  } catch (err) {
    console.error('Events error', err);
    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      eventInstances: [],
      events: [],
      search: q || '',
      myRegistrations: [],
      myInstanceIds: [],
    });
  }
});

// Add event – manager only (parent "event" table)
app.post('/events/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can add events.');

  const {
    event_name,
    event_type,
    event_description,
    event_recurrence_pattern,
    event_default_capacity,
  } = req.body;

  try {
    await db.query(
      `INSERT INTO event
         (event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)
       VALUES (?,?,?,?,?)`,
      [
        event_name,
        event_type || null,
        event_description || null,
        event_recurrence_pattern || null,
        event_default_capacity || null,
      ]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Add event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Edit event – manager only (parent "event" table)
app.post('/events/edit/:event_name', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can edit events.');

  const { event_name } = req.params;
  const {
    event_type,
    event_description,
    event_recurrence_pattern,
    event_default_capacity,
  } = req.body;

  try {
    await db.query(
      `UPDATE event
         SET event_type = ?,
             event_description = ?,
             event_recurrence_pattern = ?,
             event_default_capacity = ?
       WHERE event_name = ?`,
      [
        event_type || null,
        event_description || null,
        event_recurrence_pattern || null,
        event_default_capacity || null,
        event_name,
      ]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Edit event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Delete event – manager only (parent "event" table)
app.post('/events/delete/:event_name', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can delete events.');

  const { event_name } = req.params;

  try {
    await db.query('DELETE FROM event WHERE event_name = ?', [event_name]);
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Delete event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// User signup for an event instance (USER ONLY, NOT MANAGER)
app.post('/events/:eventInstanceId/signup', requireLogin, async (req, res) => {
  const userId = req.query.userId || req.userId || req.session.userId;
  const level = req.query.level || req.level || req.session.level;
  const { eventInstanceId } = req.params;

  // only normal users sign up
  if (isManager(level)) {
    return redirectWithUser(res, '/events', userId, level);
  }

  try {
    // Look up instance
    const instResult = await db.query(
      'SELECT event_name, event_datetime_start FROM event_instance WHERE event_instance_id = ?',
      [eventInstanceId]
    );
    const instRows = instResult.rows || [];
    if (instRows.length === 0) {
      console.error('No such event instance:', eventInstanceId);
      return redirectWithUser(res, '/events', userId, level);
    }
    const inst = instRows[0];

    // Already registered?
    const existResult = await db.query(
      `SELECT 1
         FROM registration
        WHERE participant_email = ?
          AND event_instance_id = ?`,
      [userId, eventInstanceId]
    );
    const existRows = existResult.rows || [];
    if (existRows.length > 0) {
      return redirectWithUser(res, '/events', userId, level);
    }

    // Create ID
    const idResult = await db.query(
      'SELECT COALESCE(MAX(registration_id), 0) + 1 AS next_id FROM registration',
      []
    );
    const idRows = idResult.rows || [];
    const nextId = (idRows[0] && idRows[0].next_id) || 1;

    // Insert registration
    await db.query(
      `INSERT INTO registration (
         registration_id,
         participant_email,
         event_name,
         event_datetime_start,
         registration_status,
         regestration_attended_flag,
         registration_check_in_time,
         registration_created_at,
         survey_satisfaction_score,
         survey_usefulness_score,
         survey_instructor_score,
         survey_recommendation_score,
         survey_overall_score,
         survey_nps_bucket,
         survey_comments,
         survey_submission_date,
         event_instance_id
       )
       VALUES (
         ?, ?, ?, ?, 'Registered', FALSE, NULL, NOW(),
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
         ?
       )`,
      [
        nextId,
        userId,
        inst.event_name,
        inst.event_datetime_start,
        eventInstanceId,
      ]
    );

    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Signup for event instance error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Manager: edit event instance
app.post('/event_instances/edit/:eventInstanceId', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can edit event instances.');

  const { eventInstanceId } = req.params;
  const {
    event_datetime_start,
    event_datetime_end,
    event_location,
    event_capacity,
    event_registration_deadline,
  } = req.body;

  try {
    await db.query(
      `UPDATE event_instance
         SET event_datetime_start = ?,
             event_datetime_end = ?,
             event_location = ?,
             event_capacity = ?,
             event_registration_deadline = ?
       WHERE event_instance_id = ?`,
      [
        event_datetime_start || null,
        event_datetime_end || null,
        event_location || null,
        event_capacity || null,
        event_registration_deadline || null,
        eventInstanceId,
      ]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Edit event_instance error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// Manager: delete event instance
app.post('/event_instances/delete/:eventInstanceId', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can delete event instances.');

  const { eventInstanceId } = req.params;

  try {
    await db.query(
      'DELETE FROM event_instance WHERE event_instance_id = ?',
      [eventInstanceId]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Delete event_instance error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});



// ---------- Surveys (view only – simple) ----------
// registration(..., participant_email, event_name, survey_overall_score, survey_comments, ...)

app.get('/surveys', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = `
    SELECT registration_id,
           participant_email,
           event_name,
           survey_overall_score,
           survey_comments
    FROM registration
  `;
  const params = [];

  if (q) {
    sql += `
      WHERE CAST(registration_id AS TEXT) ILIKE ?
         OR participant_email ILIKE ?
         OR event_name ILIKE ?
         OR survey_comments ILIKE ?
    `;
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY registration_id DESC';

  try {
    const surveys = await db.query(sql, params);
    res.render('surveys', {
      loggedInUserId: userId,
      loggedInLevel: level,
      surveys: surveys.rows,
      search: q || '',
    });
  } catch (err) {
    console.error('Surveys error', err);
    res.render('surveys', {
      loggedInUserId: userId,
      loggedInLevel: level,
      surveys: [],
      search: q || '',
    });
  }
});

// ---------- Milestones ----------
// milestone(milestone_id, participant_email, user_milestone_number, milestone_title, milestone_date)

app.get('/milestones', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = `
    SELECT m.milestone_id,
           m.participant_email,
           m.user_milestone_number,
           m.milestone_title,
           m.milestone_date,
           p.participant_first_name,
           p.participant_last_name
    FROM milestone m
    LEFT JOIN participant p
      ON p.participant_email = m.participant_email
  `;
  const params = [];

  if (q) {
    sql += `
      WHERE m.milestone_title ILIKE ?
         OR m.participant_email ILIKE ?
         OR p.participant_first_name ILIKE ?
         OR p.participant_last_name ILIKE ?
    `;
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY m.milestone_date DESC';

  try {
    const milestones = await db.query(sql, params);
    res.render('milestones', {
      loggedInUserId: userId,
      loggedInLevel: level,
      milestones: milestones.rows,
      search: q || '',
    });
  } catch (err) {
    console.error('Milestones error', err);
    res.render('milestones', {
      loggedInUserId: userId,
      loggedInLevel: level,
      milestones: [],
      search: q || '',
    });
  }
});

// GET assign form – manager only
app.get('/milestones/assign', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can assign milestones.');

  try {
    const participants = await db.query(
      `SELECT participant_email,
              participant_first_name,
              participant_last_name
       FROM participant
       ORDER BY participant_last_name, participant_first_name`
    );

    res.render('milestonesAssign', {
      loggedInUserId: userId,
      loggedInLevel: level,
      participants: participants.rows,
    });
  } catch (err) {
    console.error('Milestones assign error', err);
    redirectWithUser(res, '/milestones', userId, level);
  }
});

// POST assign – manager only (create milestone row for a participant)
app.post('/milestones/assign', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can assign milestones.');

  const { participant_email, milestone_title } = req.body;

  try {
    await db.query(
      `INSERT INTO milestone
         (participant_email, user_milestone_number, milestone_title, milestone_date)
       VALUES (?,?,?, CURRENT_DATE)`,
      [participant_email, 1, milestone_title]
    );
    redirectWithUser(res, '/milestones', userId, level);
  } catch (err) {
    console.error('Assign milestone error', err);
    redirectWithUser(res, '/milestones', userId, level);
  }
});

// ----------- DONATIONS (internal list + public donation page) ------------
// donation(donation_id, participant_email, user_donation_number, donation_date, donation_amount)

// ---------- Internal Donations List (viewable by anyone, with search) ----------
app.get('/donations', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = `
    SELECT d.donation_id,
           d.participant_email,
           d.donation_date,
           d.donation_amount,
           p.participant_first_name,
           p.participant_last_name
    FROM donation d
    LEFT JOIN participant p
      ON p.participant_email = d.participant_email
  `;
  const params = [];

  if (q) {
    sql += `
      WHERE p.participant_first_name ILIKE ?
         OR p.participant_last_name ILIKE ?
         OR d.participant_email ILIKE ?
    `;
    const like = '%' + q + '%';
    params.push(like, like, like);
  }

  sql += ' ORDER BY d.donation_date DESC';

  try {
    const donationsResult = await db.query(sql, params);

    // If manager, also load participants for the "Add donation" dropdown
    let participants = [];
    if (level === 'M') {
      const pResult = await db.query(
        `SELECT participant_email,
                participant_first_name,
                participant_last_name
         FROM participant
         ORDER BY participant_last_name, participant_first_name`
      );
      participants = pResult.rows;
    }

    res.render('donations', {
      loggedInUserId: userId,
      loggedInLevel: level,
      donations: donationsResult.rows,
      participants,
      search: q || '',
    });
  } catch (err) {
    console.error('Donations error', err);
    res.render('donations', {
      loggedInUserId: userId,
      loggedInLevel: level,
      donations: [],
      participants: [],
      search: q || '',
    });
  }
});

// Add donation – manager only
app.post('/donations/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can add donations.');

  const { participant_email, donation_amount } = req.body;

  try {
    await db.query(
      `INSERT INTO donation
         (participant_email, user_donation_number, donation_date, donation_amount)
       VALUES (?,?, CURRENT_DATE, ?)`,
      [participant_email, 1, donation_amount]
    );
    redirectWithUser(res, '/donations', userId, level);
  } catch (err) {
    console.error('Add donation error', err);
    redirectWithUser(res, '/donations', userId, level);
  }
});

// Edit donation – manager only (edit amount only)
app.post('/donations/edit/:donation_id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can edit donations.');

  const { donation_id } = req.params;
  const { donation_amount } = req.body;

  try {
    await db.query(
      'UPDATE donation SET donation_amount = ? WHERE donation_id = ?',
      [donation_amount, donation_id]
    );
    redirectWithUser(res, '/donations', userId, level);
  } catch (err) {
    console.error('Edit donation error', err);
    redirectWithUser(res, '/donations', userId, level);
  }
});

// Delete donation – manager only
app.post('/donations/delete/:donation_id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level))
    return res.status(403).send('Only managers can delete donations.');

  const { donation_id } = req.params;

  try {
    await db.query('DELETE FROM donation WHERE donation_id = ?', [donation_id]);
    redirectWithUser(res, '/donations', userId, level);
  } catch (err) {
    console.error('Delete donation error', err);
    redirectWithUser(res, '/donations', userId, level);
  }
});

// ---------- Public Donation Page (GET) --------------
app.get('/donate', (req, res) => {
  res.render('donatePublic', {
    success: null,
    error: null,
  });
});

// ---------- Public Donation Submission (POST) ----------
app.post('/donate', async (req, res) => {
  const { name, email, amount } = req.body;

  try {
    // 1) Try to insert/ensure participant exists (very simple; ignore if fails)
    try {
      await db.query(
        `INSERT INTO participant
           (participant_email, participant_first_name)
         VALUES (?,?)`,
        [email, name]
      );
    } catch (innerErr) {
      console.warn(
        'Participant insert (public donate) warning:',
        innerErr.message
      );
    }

    // 2) Insert donation tied to the participant_email
    await db.query(
      `INSERT INTO donation
         (participant_email, user_donation_number, donation_date, donation_amount)
       VALUES (?,?, CURRENT_DATE, ?)`,
      [email, 1, amount]
    );

    // 3) Show success message
    res.render('donatePublic', {
      success: 'Thank you for your generous support!',
      error: null,
    });
  } catch (err) {
    console.error('Public donation error', err);

    res.render('donatePublic', {
      success: null,
      error: 'There was an error processing your donation. Please try again.',
    });
  }
});

// ---------- Default route ----------
app.get('/', (req, res) => {
  res.redirect('/landing');
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Ella Rises running at http://localhost:${PORT}`)
);
