// index.js - Ella Rises simple app
require('dotenv').config();
const express = require('express');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.urlencoded({ extended: true }));

// ---------- Helpers ----------
function requireLogin(req, res, next) {
  // Keep login info in the query string (like the IS403 example)
  const { userId, level } = req.query;
  if (!userId || !level) {
    return res.redirect('/login');
  }
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

    res.redirect(
      `/landing?userId=${encodeURIComponent(userId)}&level=${level}`
    );
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).render('login', { error: 'Server error' });
  }
});

// ---------- LOGOUT ----------
app.get('/logout', (req, res) => {
  // Just redirect them to landing WITHOUT userId/level
  return res.redirect('/landing');
});

// ---------- Landing / dashboard ----------

app.get('/landing', async (req, res) => {
  // If query params exist, use them; otherwise treat as NOT logged in
  const userId = req.query.userId || null;
  const level = req.query.level || null;

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

// ---------- Participants ----------
// participant(participant_email, participant_first_name, participant_last_name, ...)

// GET /participants – list & optional search
app.get('/participants', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = `
    SELECT participant_email,
           participant_first_name,
           participant_last_name
    FROM participant
  `;
  const params = [];

  if (q) {
    sql += `
      WHERE participant_first_name ILIKE ?
         OR participant_last_name ILIKE ?
         OR participant_email ILIKE ?
    `;
    const like = '%' + q + '%';
    params.push(like, like, like);
  }

  sql += ' ORDER BY participant_last_name, participant_first_name';

  try {
    const result = await db.query(sql, params);
    res.render('participants', {
      loggedInUserId: userId,
      loggedInLevel: level,
      participants: result.rows,
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
  if (!isManager(level))
    return res.status(403).send('Only managers can add participants.');

  const {
    participant_email,
    participant_first_name,
    participant_last_name,
  } = req.body;

  try {
    await db.query(
      `INSERT INTO participant
         (participant_email, participant_first_name, participant_last_name)
       VALUES (?,?,?)`,
      [participant_email, participant_first_name, participant_last_name]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Add participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// Edit participant – manager only (email is treated as key, not edited)
app.post(
  '/participants/edit/:participant_email',
  requireLogin,
  async (req, res) => {
    const { userId, level } = req.query;
    if (!isManager(level))
      return res.status(403).send('Only managers can edit participants.');

    const { participant_email } = req.params;
    const { participant_first_name, participant_last_name } = req.body;

    try {
      await db.query(
        `UPDATE participant
           SET participant_first_name = ?,
               participant_last_name  = ?
         WHERE participant_email = ?`,
        [participant_first_name, participant_last_name, participant_email]
      );
      redirectWithUser(res, '/participants', userId, level);
    } catch (err) {
      console.error('Edit participant error', err);
      redirectWithUser(res, '/participants', userId, level);
    }
  }
);

// Delete participant – manager only
app.post(
  '/participants/delete/:participant_email',
  requireLogin,
  async (req, res) => {
    const { userId, level } = req.query;
    if (!isManager(level))
      return res.status(403).send('Only managers can delete participants.');

    const { participant_email } = req.params;

    try {
      await db.query('DELETE FROM participant WHERE participant_email = ?', [
        participant_email,
      ]);
      redirectWithUser(res, '/participants', userId, level);
    } catch (err) {
      console.error('Delete participant error', err);
      redirectWithUser(res, '/participants', userId, level);
    }
  }
);

// ---------- Events ----------
// event(event_name, event_type, event_description, event_recurrence_pattern, event_default_capacity)

app.get('/events', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = `
    SELECT event_name,
           event_type,
           event_description,
           event_recurrence_pattern,
           event_default_capacity
    FROM event
  `;
  const params = [];

  if (q) {
    sql += ' WHERE event_name ILIKE ? OR event_description ILIKE ?';
    const like = '%' + q + '%';
    params.push(like, like);
  }

  sql += ' ORDER BY event_name';

  try {
    const events = await db.query(sql, params);
    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      events: events.rows,
      search: q || '',
    });
  } catch (err) {
    console.error('Events error', err);
    res.render('events', {
      loggedInUserId: userId,
      loggedInLevel: level,
      events: [],
      search: q || '',
    });
  }
});

// Add event – manager only
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

// Edit event – manager only (identified by event_name)
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

// Delete event – manager only
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