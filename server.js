import express from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "ggr.db"));

const initDb = () => {
  console.log("Initializing database...");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT DEFAULT 'принято',
      upvotes INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 1,
      service TEXT,
      result_text TEXT,
      image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS initiatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      participants INTEGER DEFAULT 0,
      status TEXT DEFAULT 'активно',
      user_ip TEXT
    );

    CREATE TABLE IF NOT EXISTS initiative_participants (
      initiative_id INTEGER,
      user_ip TEXT,
      UNIQUE(initiative_id, user_ip)
    );

    CREATE TABLE IF NOT EXISTS users (
      ip TEXT PRIMARY KEY,
      nickname TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS votes (
      report_id INTEGER,
      user_ip TEXT,
      UNIQUE(report_id, user_ip)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER,
      nickname TEXT,
      text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const addColumn = (table, column, type) => {
    try {
      db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get();
    } catch (e) {
      console.log(`Adding ${column} to ${table}...`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };

  addColumn('reports', 'image', 'TEXT');
  addColumn('reports', 'upvotes', 'INTEGER DEFAULT 0');
  addColumn('reports', 'priority', 'INTEGER DEFAULT 1');
  addColumn('reports', 'service', 'TEXT');
  addColumn('reports', 'result_text', 'TEXT');
  addColumn('reports', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  addColumn('reports', 'status', "TEXT DEFAULT 'принято'");
  addColumn('initiatives', 'status', "TEXT DEFAULT 'активно'");
  addColumn('initiatives', 'user_ip', "TEXT");
};

initDb();

const serviceMap = {
  'Свалка': 'Чистый Город (Экорегоператор)',
  'Вырубка': 'Управление благоустройства и лесного хозяйства',
  'Загрязнение': 'Министерство природных ресурсов и экологии',
  'Воздух': 'Роспотребнадзор (Мониторинг воздуха)',
  'Животные': 'ЦБЖ (Центр безнадзорных животных)',
  'Парковка': 'ГИБДД / Административная инспекция',
  'Освещение': 'Горсвет',
  'Другое': 'Единая дежурно-диспетчерская служба'
};

const reportCount = db.prepare("SELECT COUNT(*) as count FROM reports").get();
if (reportCount.count === 0) {
  const seedReports = [
    ["Свалка", "Мусор у берега Дона", "Набережная", "в работе", 45, serviceMap["Свалка"]],
    ["Вырубка", "Незаконная вырубка в Кумженской роще", "Кумженская роща", "принято", 120, serviceMap["Вырубка"]],
    ["Загрязнение", "Сброс сточных вод в Темерник", "р. Темерник", "в работе", 89, serviceMap["Загрязнение"]],
    ["Воздух", "Неприятный запах гари по ночам", "Западный жилой массив", "принято", 210, serviceMap["Воздух"]],
    ["Парковка", "Парковка на газоне в парке Островского", "Парк Островского", "решено", 34, serviceMap["Парковка"]],
    ["Животные", "Стая агрессивных собак у школы", "Северный жилой массив", "в работе", 56, serviceMap["Животные"]],
    ["Освещение", "Не работают фонари на аллее", "Пушкинская", "решено", 12, serviceMap["Освещение"]]
  ];
  
  const insert = db.prepare("INSERT INTO reports (type, description, location, status, upvotes, service) VALUES (?, ?, ?, ?, ?, ?)");
  seedReports.forEach(r => insert.run(...r));
}

const initiativeCount = db.prepare("SELECT COUNT(*) as count FROM initiatives").get();
if (initiativeCount.count === 0) {
  const seedInitiatives = [
    ["Субботник в парке", "Очистка территории от мусора", "2024-05-20", 15, "активно"],
    ["Посадка деревьев", "Высадка саженцев липы", "2024-06-10", 8, "активно"],
    ["Эко-лекция", "Лекция о раздельном сборе мусора", "2024-04-15", 42, "завершено"]
  ];
  const insert = db.prepare("INSERT INTO initiatives (title, description, date, participants, status) VALUES (?, ?, ?, ?, ?)");
  seedInitiatives.forEach(i => insert.run(...i));
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

const getUserIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
};

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'join') {
        ws.reportId = data.reportId;
      }
    } catch (e) {
      console.error('WS message error:', e);
    }
  });
});

const broadcastComment = (reportId, comment) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.reportId === reportId) {
      client.send(JSON.stringify({ type: 'new_comment', comment }));
    }
  });
};

app.get("/api/profile", (req, res) => {
  const ip = getUserIp(req);
  const user = db.prepare("SELECT * FROM users WHERE ip = ?").get(ip);
  res.json(user || { ip, nickname: null });
});

app.post("/api/profile", (req, res) => {
  const ip = getUserIp(req);
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ error: "Nickname required" });
  
  db.prepare("INSERT OR REPLACE INTO users (ip, nickname) VALUES (?, ?)").run(ip, nickname);
  res.json({ ip, nickname });
});

app.get("/api/reports", (req, res) => {
  try {
    const reports = db.prepare(`
      SELECT * FROM reports 
      ORDER BY 
        CASE WHEN status = 'решено' THEN 1 ELSE 0 END ASC,
        priority DESC,
        upvotes DESC, 
        created_at DESC
    `).all();
    res.json(reports);
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: "Failed to fetch reports", details: error.message });
  }
});

app.post("/api/reports/:id/upvote", (req, res) => {
  try {
    const { id } = req.params;
    const ip = getUserIp(req);

    const existingVote = db.prepare("SELECT * FROM votes WHERE report_id = ? AND user_ip = ?").get(id, ip);
    if (existingVote) {
      return res.status(400).json({ error: "Вы уже голосовали за эту проблему" });
    }

    db.prepare("INSERT INTO votes (report_id, user_ip) VALUES (?, ?)").run(id, ip);
    db.prepare("UPDATE reports SET upvotes = upvotes + 1 WHERE id = ?").run(id);
    
    const updated = db.prepare("SELECT upvotes FROM reports WHERE id = ?").get(id);
    res.json(updated);
  } catch (error) {
    console.error("Error upvoting report:", error);
    res.status(500).json({ error: "Failed to upvote report", details: error.message });
  }
});

app.get("/api/reports/:id/comments", (req, res) => {
  try {
    const { id } = req.params;
    const comments = db.prepare("SELECT * FROM comments WHERE report_id = ? ORDER BY created_at ASC").all(id);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

app.post("/api/reports/:id/comments", (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const ip = getUserIp(req);
    
    const user = db.prepare("SELECT nickname FROM users WHERE ip = ?").get(ip);
    if (!user) return res.status(401).json({ error: "Сначала укажите никнейм" });
    if (!text) return res.status(400).json({ error: "Текст сообщения пуст" });

    const result = db.prepare("INSERT INTO comments (report_id, nickname, text) VALUES (?, ?, ?)").run(id, user.nickname, text);
    const newComment = db.prepare("SELECT * FROM comments WHERE id = ?").get(result.lastInsertRowid);
    
    broadcastComment(parseInt(id), newComment);
    res.json(newComment);
  } catch (error) {
    res.status(500).json({ error: "Failed to post comment" });
  }
});

app.post("/api/reports/:id/resolve", (req, res) => {
  try {
    const { id } = req.params;
    const { result_text } = req.body;
    db.prepare("UPDATE reports SET status = 'решено', result_text = ? WHERE id = ?").run(result_text || 'Проблема устранена', id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error resolving report:", error);
    res.status(500).json({ error: "Failed to resolve report", details: error.message });
  }
});

app.post("/api/reports/:id/status", (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['принято', 'в работе', 'решено'].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(status, id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ error: "Failed to update status", details: error.message });
  }
});

app.post("/api/reports", (req, res) => {
  try {
    const { type, description, location, image } = req.body;
    if (!type || !description || !location) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const similarReports = db.prepare(`
      SELECT id, priority FROM reports 
      WHERE type = ? AND (location LIKE ? OR ? LIKE '%' || location || '%')
      AND status != 'решено'
    `).all(type, `%${location}%`, location);

    let priority = 1;
    if (similarReports.length > 0) {
      priority = similarReports.length + 1;
      
      const updatePriority = db.prepare("UPDATE reports SET priority = priority + 1 WHERE id = ?");
      similarReports.forEach(r => updatePriority.run(r.id));
      
      console.log(`Scale detected for ${type} at ${location}. New priority: ${priority}`);
    }

    const service = serviceMap[type] || serviceMap['Другое'];

    const result = db.prepare("INSERT INTO reports (type, description, location, image, priority, service) VALUES (?, ?, ?, ?, ?, ?)").run(type, description, location, image, priority, service);
    res.json({ id: result.lastInsertRowid, priority, service });
  } catch (error) {
    console.error("Error creating report:", error);
    res.status(500).json({ error: "Failed to create report", details: error.message });
  }
});

app.get("/api/initiatives", (req, res) => {
  try {
    const initiatives = db.prepare("SELECT * FROM initiatives ORDER BY date ASC").all();
    res.json(initiatives);
  } catch (error) {
    console.error("Error fetching initiatives:", error);
    res.status(500).json({ error: "Failed to fetch initiatives", details: error.message });
  }
});

app.post("/api/initiatives", (req, res) => {
  try {
    const { title, description, date } = req.body;
    const ip = getUserIp(req);
    if (!title || !description || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const result = db.prepare("INSERT INTO initiatives (title, description, date, user_ip) VALUES (?, ?, ?, ?)").run(title, description, date, ip);
    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("Error creating initiative:", error);
    res.status(500).json({ error: "Failed to create initiative" });
  }
});

app.post("/api/initiatives/:id/join", (req, res) => {
  try {
    const { id } = req.params;
    const ip = getUserIp(req);

    const existing = db.prepare("SELECT * FROM initiative_participants WHERE initiative_id = ? AND user_ip = ?").get(id, ip);
    if (existing) {
      return res.status(400).json({ error: "Вы уже записаны на это мероприятие" });
    }

    db.prepare("INSERT INTO initiative_participants (initiative_id, user_ip) VALUES (?, ?)").run(id, ip);
    db.prepare("UPDATE initiatives SET participants = participants + 1 WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error joining initiative:", error);
    res.status(500).json({ error: "Failed to join initiative" });
  }
});

app.post("/api/initiatives/:id/complete", (req, res) => {
  try {
    const { id } = req.params;
    const ip = getUserIp(req);
    
    const initiative = db.prepare("SELECT user_ip FROM initiatives WHERE id = ?").get(id);
    if (!initiative) return res.status(404).json({ error: "Not found" });
    if (initiative.user_ip && initiative.user_ip !== ip) {
      return res.status(403).json({ error: "Только создатель может завершить мероприятие" });
    }

    db.prepare("UPDATE initiatives SET status = 'завершено' WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error completing initiative:", error);
    res.status(500).json({ error: "Failed to complete initiative" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GGR Server running on http://localhost:${PORT}`);
});
