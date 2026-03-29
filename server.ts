import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("reimbursements.db");

// --- Database Initialization ---
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_currency TEXT NOT NULL,
    country TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    manager_id TEXT,
    company_id TEXT NOT NULL,
    department TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    base_amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL,
    status TEXT DEFAULT 'Pending',
    receipt_url TEXT,
    current_step INTEGER DEFAULT 0,
    FOREIGN KEY (employee_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS approval_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS approval_logs (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL,
    approver_id TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    comment TEXT,
    date TEXT NOT NULL,
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (approver_id) REFERENCES users(id)
  );
`);

// --- Seed Data (if empty) ---
const companyCount = db.prepare("SELECT count(*) as count FROM companies").get() as { count: number };
if (companyCount.count === 0) {
  db.prepare("INSERT INTO companies (id, name, default_currency, country) VALUES (?, ?, ?, ?)").run(
    "comp-1", "Acme Corp", "USD", "United States"
  );
  
  const users = [
    ["u-1", "Alice Admin", "alice@acme.com", "Admin", null, "comp-1", "Administration"],
    ["u-2", "Bob Manager", "bob@acme.com", "Manager", null, "comp-1", "Engineering"],
    ["u-3", "Charlie Employee", "charlie@acme.com", "Employee", "u-2", "comp-1", "Engineering"],
    ["u-4", "Diana Finance", "diana@acme.com", "Finance", null, "comp-1", "Finance"],
  ];
  
  const insertUser = db.prepare("INSERT INTO users (id, name, email, role, manager_id, company_id, department) VALUES (?, ?, ?, ?, ?, ?, ?)");
  users.forEach(u => insertUser.run(...u));

  db.prepare("INSERT INTO approval_rules (id, company_id, steps_json) VALUES (?, ?, ?)").run(
    "r-1", "comp-1", JSON.stringify({
      id: "r-1",
      name: "Standard Approval",
      description: "Default approval flow",
      flowType: "Sequential",
      isManagerApproverAtStart: true,
      steps: [
        { role: "Manager", isManagerApprover: true, isRequired: true },
        { role: "Finance", isManagerApprover: false, percentageRequired: 100, isRequired: true }
      ]
    })
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- API Routes ---

  app.post("/api/signup", (req, res) => {
    const { companyName, country, defaultCurrency, adminName, adminEmail } = req.body;
    const companyId = `comp-${Date.now()}`;
    const adminId = `u-${Date.now()}`;

    db.prepare("INSERT INTO companies (id, name, default_currency, country) VALUES (?, ?, ?, ?)").run(
      companyId, companyName, defaultCurrency, country
    );

    db.prepare("INSERT INTO users (id, name, email, role, company_id, department) VALUES (?, ?, ?, ?, ?, ?)").run(
      adminId, adminName, adminEmail, "Admin", companyId, "Administration"
    );

    // Default rules
    const ruleId = `r-${Date.now()}`;
    db.prepare("INSERT INTO approval_rules (id, company_id, steps_json) VALUES (?, ?, ?)").run(
      ruleId, companyId, JSON.stringify({
        id: ruleId,
        name: "Default Approval",
        description: "Initial approval flow",
        flowType: "Sequential",
        isManagerApproverAtStart: true,
        steps: [
          { role: "Manager", isManagerApprover: true, isRequired: true },
          { role: "Finance", isManagerApprover: false, isRequired: true }
        ]
      })
    );

    res.json({ companyId, adminId, role: "Admin" });
  });

  app.get("/api/company/:id", (req, res) => {
    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(req.params.id);
    const rules = db.prepare("SELECT * FROM approval_rules WHERE company_id = ?").all(req.params.id);
    res.json({ ...company, rules: rules.map(r => JSON.parse(r.steps_json)) });
  });

  app.put("/api/approval-rules", (req, res) => {
    const { companyId, rules } = req.body;
    // Clear existing rules and insert new ones
    db.prepare("DELETE FROM approval_rules WHERE company_id = ?").run(companyId);
    const insert = db.prepare("INSERT INTO approval_rules (id, company_id, steps_json) VALUES (?, ?, ?)");
    rules.forEach((rule: any) => {
      insert.run(rule.id, companyId, JSON.stringify(rule));
    });
    res.json({ success: true });
  });

  app.post("/api/users", (req, res) => {
    const { name, email, role, managerId, companyId, department } = req.body;
    const id = `u-${Date.now()}`;
    try {
      db.prepare("INSERT INTO users (id, name, email, role, manager_id, company_id, department) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id, name, email, role, managerId || null, companyId, department
      );
      res.json({ id, name, email, role });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/users", (req, res) => {
    const { companyId, managerId } = req.query;
    let users;
    if (companyId) {
      users = db.prepare("SELECT * FROM users WHERE company_id = ?").all(companyId);
    } else if (managerId) {
      users = db.prepare("SELECT * FROM users WHERE manager_id = ?").all(managerId);
    } else {
      users = db.prepare("SELECT * FROM users").all();
    }
    res.json(users);
  });

  app.get("/api/expenses", (req, res) => {
    const { employeeId, managerId } = req.query;
    let expenses;
    if (employeeId) {
      expenses = db.prepare("SELECT e.*, u.name as employeeName FROM expenses e JOIN users u ON e.employee_id = u.id WHERE e.employee_id = ?").all(employeeId);
    } else if (managerId) {
      expenses = db.prepare("SELECT e.*, u.name as employeeName FROM expenses e JOIN users u ON e.employee_id = u.id WHERE u.manager_id = ?").all(managerId);
    } else {
      expenses = db.prepare("SELECT e.*, u.name as employeeName FROM expenses e JOIN users u ON e.employee_id = u.id").all();
    }
    res.json(expenses);
  });

  app.post("/api/expenses", (req, res) => {
    const { employeeId, amount, currency, baseAmount, category, description, date } = req.body;
    const id = `e-${Date.now()}`;
    db.prepare(`
      INSERT INTO expenses (id, employee_id, amount, currency, base_amount, category, description, date, status, current_step)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0)
    `).run(id, employeeId, amount, currency, baseAmount, category, description, date);
    res.json({ id, status: 'Pending' });
  });

  app.get("/api/stats", (req, res) => {
    const { employeeId, managerId, companyId } = req.query;
    let stats;
    if (employeeId) {
      stats = db.prepare(`
        SELECT 
          SUM(CASE WHEN status = 'Approved' THEN base_amount ELSE 0 END) as totalSpent,
          SUM(CASE WHEN status = 'Pending' THEN base_amount ELSE 0 END) as totalPending,
          SUM(CASE WHEN status = 'Rejected' THEN base_amount ELSE 0 END) as totalRejected,
          COUNT(*) as totalCount
        FROM expenses 
        WHERE employee_id = ?
      `).get(employeeId);
    } else if (managerId) {
      stats = db.prepare(`
        SELECT 
          SUM(CASE WHEN e.status = 'Approved' THEN e.base_amount ELSE 0 END) as totalSpent,
          SUM(CASE WHEN e.status = 'Pending' THEN e.base_amount ELSE 0 END) as totalPending,
          SUM(CASE WHEN e.status = 'Rejected' THEN e.base_amount ELSE 0 END) as totalRejected,
          COUNT(*) as totalCount
        FROM expenses e
        JOIN users u ON e.employee_id = u.id
        WHERE u.manager_id = ?
      `).get(managerId);
    } else if (companyId) {
      stats = db.prepare(`
        SELECT 
          SUM(CASE WHEN e.status = 'Approved' THEN e.base_amount ELSE 0 END) as totalSpent,
          SUM(CASE WHEN e.status = 'Pending' THEN e.base_amount ELSE 0 END) as totalPending,
          SUM(CASE WHEN e.status = 'Rejected' THEN e.base_amount ELSE 0 END) as totalRejected,
          COUNT(*) as totalCount
        FROM expenses e
        JOIN users u ON e.employee_id = u.id
        WHERE u.company_id = ?
      `).get(companyId);
    }
    res.json(stats || { totalSpent: 0, totalPending: 0, totalRejected: 0, totalCount: 0 });
  });

  app.get("/api/approvals/pending", (req, res) => {
    const { role, userId } = req.query;
    // Simplified logic: find expenses where the current step matches the role
    // In a real app, we'd check the rules engine
    const expenses = db.prepare(`
      SELECT e.*, u.name as employeeName 
      FROM expenses e 
      JOIN users u ON e.employee_id = u.id 
      WHERE e.status = 'Pending'
    `).all();
    res.json(expenses);
  });

  app.post("/api/approvals/action", (req, res) => {
    const { expenseId, userId, role, action, comment } = req.body;
    const date = new Date().toISOString().split('T')[0];
    const logId = `l-${Date.now()}`;
    
    db.prepare(`
      INSERT INTO approval_logs (id, expense_id, approver_id, role, status, comment, date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(logId, expenseId, userId, role, action === 'approve' ? 'Approved' : 'Rejected', comment, date);

    if (action === 'reject') {
      db.prepare("UPDATE expenses SET status = 'Rejected' WHERE id = ?").run(expenseId);
    } else {
      // Logic for multi-step: increment step or mark as approved if last step
      const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get() as any;
      const rule = db.prepare("SELECT * FROM approval_rules WHERE company_id = 'comp-1'").get() as any;
      const steps = JSON.parse(rule.steps_json);
      
      if (expense.current_step >= steps.length - 1) {
        db.prepare("UPDATE expenses SET status = 'Approved' WHERE id = ?").run(expenseId);
      } else {
        db.prepare("UPDATE expenses SET current_step = current_step + 1 WHERE id = ?").run(expenseId);
      }
    }
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
