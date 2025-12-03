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
  res.redirect(`${path}?userId=${userId}&level=${level}`);
}

/*
// ---------- Login ----------

// GET /login – show login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login – check users table
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query(
      'SELECT id, username, level FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).render('login', { error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    redirectWithUser(res, '/landing', user.id, user.level);
  } catch (err) {
    console.error('Login error', err);
    res.status(500).render('login', { error: 'Server error' });
  }
    // same helper we already had
    res.redirect(`/landing?userId=${user.id}&level=${user.level}`);
});
*/




// ---------- Login (hard-coded for now) ----------

// GET /login – show login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login – NO database, just hard-coded users
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Hard-coded accounts
  // Manager: manager / manager123
  // Common user: user / user123
  let user = null;

  if (username === 'manager' && password === 'manager123') {
    user = { id: 1, level: 'M' };   // manager
  } else if (username === 'user' && password === 'user123') {
    user = { id: 2, level: 'U' };   // common user
  }

  if (!user) {
    return res.status(401).render('login', { error: 'Invalid username or password' });
  }

  // same helper we already had
  res.redirect(`/landing?userId=${user.id}&level=${user.level}`);
});





// ---------- Landing / dashboard ----------

app.get('/landing', async (req, res) => {
  // If query params exist, use them; otherwise act like a normal user
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';  // default to common user

  try {
    const [participants, events, donations, surveys] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM participant'),
      db.query('SELECT COUNT(*) AS count FROM event'),
      db.query('SELECT COALESCE(SUM(amount),0) AS total FROM participantDonation'),
      db.query('SELECT COUNT(*) AS count FROM registrationAndSurvey'),
    ]);

    res.render('landing', {
      loggedInUserId: userId,
      loggedInLevel: level,
      stats: {
        participants: participants.rows[0].count,
        events: events.rows[0].count,
        donationsTotal: donations.rows[0].total,
        surveys: surveys.rows[0].count,
      }
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

// GET /participants – list & optional search
app.get('/participants', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = 'SELECT id, firstname, lastname, email FROM participant';
  const params = [];

  if (q) {
    sql += ' WHERE firstname ILIKE $1 OR lastname ILIKE $1 OR email ILIKE $1';
    params.push('%' + q + '%');
  }

  sql += ' ORDER BY lastname, firstname';

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
  if (!isManager(level)) return res.status(403).send('Only managers can add participants.');

  const { firstname, lastname, email } = req.body;

  try {
    await db.query(
      'INSERT INTO participant (firstname, lastname, email) VALUES ($1,$2,$3)',
      [firstname, lastname, email]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Add participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// Edit participant – manager only
app.post('/participants/edit/:id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can edit participants.');

  const { id } = req.params;
  const { firstname, lastname, email } = req.body;

  try {
    await db.query(
      'UPDATE participant SET firstname=$1, lastname=$2, email=$3 WHERE id=$4',
      [firstname, lastname, email, id]
    );
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Edit participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// Delete participant – manager only
app.post('/participants/delete/:id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can delete participants.');

  const { id } = req.params;

  try {
    await db.query('DELETE FROM participant WHERE id = $1', [id]);
    redirectWithUser(res, '/participants', userId, level);
  } catch (err) {
    console.error('Delete participant error', err);
    redirectWithUser(res, '/participants', userId, level);
  }
});

// ---------- Events ----------
app.get('/events', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = 'SELECT id, name, description FROM event';
  const params = [];

  if (q) {
    sql += ' WHERE name ILIKE $1 OR description ILIKE $1';
    params.push('%' + q + '%');
  }

  sql += ' ORDER BY name';

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

app.post('/events/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can add events.');

  const { name, description } = req.body;

  try {
    await db.query(
      'INSERT INTO event (name, description) VALUES ($1,$2)',
      [name, description]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Add event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

app.post('/events/edit/:id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can edit events.');

  const { id } = req.params;
  const { name, description } = req.body;

  try {
    await db.query(
      'UPDATE event SET name=$1, description=$2 WHERE id=$3',
      [name, description, id]
    );
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Edit event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

app.post('/events/delete/:id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can delete events.');

  const { id } = req.params;

  try {
    await db.query('DELETE FROM event WHERE id=$1', [id]);
    redirectWithUser(res, '/events', userId, level);
  } catch (err) {
    console.error('Delete event error', err);
    redirectWithUser(res, '/events', userId, level);
  }
});

// ---------- Surveys (view only – simple) ----------

app.get('/surveys', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  // Base query
  let sql = `
    SELECT id, participant_id, eventoccurrence_id, overallscore, comments
    FROM registrationAndSurvey
  `;
  const params = [];

  if (q) {
    // Search by id, participant_id, eventoccurrence_id, or comments text
    sql += `
      WHERE CAST(id AS TEXT) ILIKE $1
         OR CAST(participant_id AS TEXT) ILIKE $1
         OR CAST(eventoccurrence_id AS TEXT) ILIKE $1
         OR comments ILIKE $1
    `;
    params.push('%' + q + '%');
  }

  sql += ' ORDER BY id DESC';

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

app.get('/milestones', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = 'SELECT id, name, description FROM milestone';
  const params = [];

  if (q) {
    sql += ' WHERE name ILIKE $1 OR description ILIKE $1';
    params.push('%' + q + '%');
  }

  sql += ' ORDER BY name';

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
  if (!isManager(level)) return res.status(403).send('Only managers can assign milestones.');

  try {
    const participants = await db.query(
      'SELECT id, firstname, lastname FROM participant ORDER BY lastname'
    );
    const milestones = await db.query(
      'SELECT id, name FROM milestone ORDER BY name'
    );

    res.render('milestonesAssign', {
      loggedInUserId: userId,
      loggedInLevel: level,
      participants: participants.rows,
      milestones: milestones.rows,
    });
  } catch (err) {
    console.error('Milestones assign error', err);
    redirectWithUser(res, '/milestones', userId, level);
  }
});

// POST assign – manager only
app.post('/milestones/assign', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can assign milestones.');

  const { participant_id, milestone_id } = req.body;

  try {
    await db.query(
      'INSERT INTO participantMilestone (participant_id, milestone_id, date_achieved) VALUES ($1,$2,CURRENT_DATE)',
      [participant_id, milestone_id]
    );
    redirectWithUser(res, '/milestones', userId, level);
  } catch (err) {
    console.error('Assign milestone error', err);
    redirectWithUser(res, '/milestones', userId, level);
  }
});

// ----------- DONATIONS (internal list + public donation page) ------------

// ---------- Internal Donations List (viewable by anyone, with search) ----------
app.get('/donations', async (req, res) => {
  const userId = req.query.userId || null;
  const level = req.query.level || 'U';
  const q = req.query.q;

  let sql = `
    SELECT pd.id,
           p.firstname,
           p.lastname,
           pd.amount,
           pd.donationdate
    FROM participantDonation pd
    JOIN participant p ON p.id = pd.participant_id
  `;
  const params = [];

  if (q) {
    sql += ' WHERE p.firstname ILIKE $1 OR p.lastname ILIKE $1';
    params.push('%' + q + '%');
  }

  sql += ' ORDER BY pd.donationdate DESC';

  try {
    const donationsResult = await db.query(sql, params);

    // If manager, also load participants for the "Add donation" dropdown
    let participants = [];
    if (level === 'M') {
      const pResult = await db.query(
        'SELECT id, firstname, lastname FROM participant ORDER BY lastname, firstname'
      );
      participants = pResult.rows;
    }

    res.render('donations', {
      loggedInUserId: userId,
      loggedInLevel: level,
      donations: donationsResult.rows,
      participants,      // 👈 new
      search: q || '',
    });
  } catch (err) {
    console.error('Donations error', err);
    res.render('donations', {
      loggedInUserId: userId,
      loggedInLevel: level,
      donations: [],
      participants: [],   // 👈 new
      search: q || '',
    });
  }
});

// Add donation – manager only
app.post('/donations/add', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can add donations.');

  const { participant_id, amount } = req.body;

  try {
    await db.query(
      'INSERT INTO participantDonation (participant_id, amount, donationdate) VALUES ($1, $2, CURRENT_DATE)',
      [participant_id, amount]
    );
    redirectWithUser(res, '/donations', userId, level);
  } catch (err) {
    console.error('Add donation error', err);
    redirectWithUser(res, '/donations', userId, level);
  }
});

// Edit donation – manager only (edit amount only, date stays the same)
app.post('/donations/edit/:id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can edit donations.');

  const { id } = req.params;
  const { amount } = req.body;

  try {
    await db.query(
      'UPDATE participantDonation SET amount = $1 WHERE id = $2',
      [amount, id]
    );
    redirectWithUser(res, '/donations', userId, level);
  } catch (err) {
    console.error('Edit donation error', err);
    redirectWithUser(res, '/donations', userId, level);
  }
});

// Delete donation – manager only
app.post('/donations/delete/:id', requireLogin, async (req, res) => {
  const { userId, level } = req.query;
  if (!isManager(level)) return res.status(403).send('Only managers can delete donations.');

  const { id } = req.params;

  try {
    await db.query('DELETE FROM participantDonation WHERE id = $1', [id]);
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
    // 1) Insert participant (basic donor record)
    const participant = await db.query(
      'INSERT INTO participant (firstname, email) VALUES ($1, $2) RETURNING id',
      [name, email]
    );

    // 2) Insert donation tied to the participant
    await db.query(
      'INSERT INTO participantDonation (participant_id, amount, donationdate) VALUES ($1, $2, CURRENT_DATE)',
      [participant.rows[0].id, amount]
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
  // Just act like a normal (non-manager) user
  res.redirect('/landing');
});


// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Ella Rises running at http://localhost:${PORT}`)
);
