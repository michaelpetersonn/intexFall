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

// Helper to format 10-digit phone as xxx-xxx-xxxx
app.locals.formatPhone = function (phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length !== 10) return phone; // fall back if weird
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

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
app.get('/participants', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || null; // 'M', 'U', or null (visitor)
  const q = req.query.q;

  const params = [];

  // Base query: get ALL participant fields we care about + milestones_list
  let sql = `
    SELECT
      p.participant_email,
      p.participant_first_name,
      p.participant_last_name,
      TO_CHAR(p.participant_dob, 'MM/DD/YYYY') AS participant_dob,
      p.participant_role,
      p.participant_phone,
      p.participant_city,
      p.participant_state,
      p.participant_zip,
      p.participant_school_or_employer,
      p.participant_field_of_interest,
      p.total_donations,
      COALESCE(
        STRING_AGG(
          m.milestone_title || ' (' || TO_CHAR(m.milestone_date, 'MM/DD/YYYY') || ')',
          ', ' ORDER BY m.milestone_date
        ),
        ''
      ) AS milestones_list
    FROM participant p
    LEFT JOIN milestone m
      ON m.participant_email = p.participant_email
  `;

  // Optional search (must come BEFORE GROUP BY)
  if (q) {
    sql += `
      WHERE
        p.participant_first_name ILIKE ?
        OR p.participant_last_name  ILIKE ?
        OR p.participant_email      ILIKE ?
    `;
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  sql += `
    GROUP BY
      p.participant_email,
      p.participant_first_name,
      p.participant_last_name,
      p.participant_dob,
      p.participant_role,
      p.participant_phone,
      p.participant_city,
      p.participant_state,
      p.participant_zip,
      p.participant_school_or_employer,
      p.participant_field_of_interest,
      p.total_donations
    ORDER BY
      p.participant_last_name,
      p.participant_first_name
  `;

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

// ---------- NEW PARTICIPANT FORM (GET) ----------
app.get('/participants/new', requireLogin, (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can add participants.');
  }

  res.render('participantsNew', {
    loggedInUserId: userId,
    loggedInLevel: level,
  });
});

// ---------- ADD PARTICIPANT (POST) ----------
app.post('/participants/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can add participants.');

  const {
    participant_email,
    participant_first_name,
    participant_last_name,
    participant_role,
    participant_dob,                 // from <input type="date">
    participant_phone,
    participant_city,
    participant_state,
    participant_zip,
    participant_school_or_employer,
    participant_field_of_interest,
  } = req.body;

  try {
    await db.query(
      `
      INSERT INTO participant (
        participant_email,
        participant_first_name,
        participant_last_name,
        participant_dob,
        participant_role,
        participant_phone,
        participant_city,
        participant_state,
        participant_zip,
        participant_school_or_employer,
        participant_field_of_interest
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        participant_email,
        participant_first_name,
        participant_last_name,
        participant_dob || null,
        participant_role || null,
        participant_phone || null,
        participant_city || null,
        participant_state || null,
        participant_zip || null,
        participant_school_or_employer || null,
        participant_field_of_interest || null,
      ]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Add participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// ---------- EDIT PARTICIPANT FORM (GET) ----------
app.get('/participants/edit/:participant_email', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can edit participants.');
  }

  const { participant_email } = req.params;

  try {
    const result = await db.query(
      `
      SELECT
        participant_email,
        participant_first_name,
        participant_last_name,
        TO_CHAR(participant_dob, 'YYYY-MM-DD') AS participant_dob_input,
        participant_role,
        participant_phone,
        participant_city,
        participant_state,
        participant_zip,
        participant_school_or_employer,
        participant_field_of_interest
      FROM participant
      WHERE participant_email = ?
      `,
      [participant_email]
    );

    const rows = result.rows || result;
    if (!rows.length) {
      return res.status(404).send('Participant not found.');
    }

    const participant = rows[0];

    res.render('participantsEdit', {
      loggedInUserId: userId,
      loggedInLevel: level,
      participant,
    });
  } catch (err) {
    console.error('Edit participant (GET) error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// ---------- EDIT PARTICIPANT (POST) ----------
app.post('/participants/edit/:participant_email', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can edit participants.');

  const { participant_email } = req.params;
  const {
    participant_first_name,
    participant_last_name,
    participant_role,
    participant_dob,
    participant_phone,
    participant_city,
    participant_state,
    participant_zip,
    participant_school_or_employer,
    participant_field_of_interest,
  } = req.body;

  try {
    await db.query(
      `
      UPDATE participant
      SET participant_first_name        = ?,
          participant_last_name         = ?,
          participant_dob               = ?,
          participant_role              = ?,
          participant_phone             = ?,
          participant_city              = ?,
          participant_state             = ?,
          participant_zip               = ?,
          participant_school_or_employer = ?,
          participant_field_of_interest = ?
      WHERE participant_email           = ?
      `,
      [
        participant_first_name,
        participant_last_name,
        participant_dob || null,
        participant_role || null,
        participant_phone || null,
        participant_city || null,
        participant_state || null,
        participant_zip || null,
        participant_school_or_employer || null,
        participant_field_of_interest || null,
        participant_email,
      ]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Edit participant (POST) error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// ---------- DELETE PARTICIPANT ----------
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
  const level = req.query.level || null; // 'M', 'U', or null (visitor)
  const q = req.query.q;

  const params = [];

  let sql = `
    SELECT
      m.milestone_id,
      m.participant_email,
      m.user_milestone_number,
      m.milestone_title,
      TO_CHAR(m.milestone_date, 'YYYY-MM-DD') AS milestone_date,
      p.participant_first_name,
      p.participant_last_name
    FROM milestone m
    LEFT JOIN participant p
      ON p.participant_email = m.participant_email
  `;

  if (q) {
    sql += `
      WHERE
        m.milestone_title ILIKE ?
        OR m.participant_email ILIKE ?
        OR p.participant_first_name ILIKE ?
        OR p.participant_last_name ILIKE ?
    `;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  sql += `
    ORDER BY
      m.milestone_date DESC,
      m.milestone_id DESC
  `;

  try {
    const result = await db.query(sql, params);
    const rows = result.rows || result;

    res.render('milestones', {
      loggedInUserId: userId,
      loggedInLevel: level,
      milestones: rows,
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

// Add milestone – manager only
app.post('/milestones/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can add milestones.');
  }

  const { participant_email, milestone_title, milestone_date } = req.body;

  try {
    await db.query(
      `
      INSERT INTO milestone (
        participant_email,
        user_milestone_number,
        milestone_title,
        milestone_date
      )
      VALUES (?, 1, ?, ?)
      `,
      [participant_email, milestone_title, milestone_date || null]
    );

    redirectWithUser(res, '/milestones', userId, level);
  } catch (err) {
    console.error('Add milestone error', err);
    redirectWithUser(res, '/milestones', userId, level);
  }
});

// GET edit milestone – manager only
app.get('/milestones/edit/:milestone_id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can edit milestones.');
  }

  const { milestone_id } = req.params;

  try {
    const result = await db.query(
      `
      SELECT
        m.milestone_id,
        m.participant_email,
        m.milestone_title,
        TO_CHAR(m.milestone_date, 'YYYY-MM-DD') AS milestone_date,
        p.participant_first_name,
        p.participant_last_name
      FROM milestone m
      LEFT JOIN participant p
        ON p.participant_email = m.participant_email
      WHERE m.milestone_id = ?
      `,
      [milestone_id]
    );

    const rows = result.rows || result;

    if (!rows.length) {
      console.warn('Milestone not found:', milestone_id);
      return redirectWithUser(res, '/milestones', userId, level);
    }

    const milestone = rows[0];

    res.render('milestoneEdit', {
      loggedInUserId: userId,
      loggedInLevel: level,
      milestone,
    });
  } catch (err) {
    console.error('Load milestone for edit error:', err);
    redirectWithUser(res, '/milestones', userId, level);
  }
});

// POST edit milestone – manager only
app.post('/milestones/edit/:milestone_id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can edit milestones.');
  }

  const { milestone_id } = req.params;
  const { milestone_title, milestone_date } = req.body;

  try {
    await db.query(
      `
      UPDATE milestone
      SET milestone_title = ?,
          milestone_date  = ?
      WHERE milestone_id  = ?
      `,
      [milestone_title, milestone_date || null, milestone_id]
    );

    redirectWithUser(res, '/milestones', userId, level);
  } catch (err) {
    console.error('Update milestone error:', err);
    redirectWithUser(res, '/milestones', userId, level);
  }
});

// Delete milestone – manager only
app.post('/milestones/delete/:milestone_id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) {
    return res.status(403).send('Only managers can delete milestones.');
  }

  const { milestone_id } = req.params;

  try {
    await db.query(
      'DELETE FROM milestone WHERE milestone_id = ?',
      [milestone_id]
    );

    redirectWithUser(res, '/milestones', userId, level);
  } catch (err) {
    console.error('Delete milestone error:', err);
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