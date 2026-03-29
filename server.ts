import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MySQL Database Connection ---
const pool = mysql.createPool({
  host: 'localhost',
  user: 'user',
  password: 'root',
  database: 'odoo_reimbursement',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Helper to map DB row to CamelCase for Frontend
function mapUser(u: any) {
  if (!u) return u;
  return {
    ...u,
    companyId: u.company_id,
    managerId: u.manager_id,
    directorId: u.director_id,
    password: u.password,
  };
}

function mapExpense(e: any) {
  if (!e) return e;
  const dateStr = e.date instanceof Date ? e.date.toISOString().split('T')[0] : e.date;
  return {
    ...e,
    date: dateStr,
    employeeId: e.employee_id,
    baseAmount: e.base_amount,
    receiptUrl: e.receipt_url,
    currentStep: e.current_step,
  };
}

function mapCompany(c: any) {
  if (!c) return c;
  return {
    ...c,
    defaultCurrency: c.default_currency,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- API Routes ---

  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    console.log("Login attempt:", { email, password });
    try {
      const [users] = await pool.execute("SELECT * FROM users WHERE email = ? AND password = ?", [email, password]) as any[];
      const user = users[0];
      if (user) {
        res.json(mapUser(user));
      } else {
        res.status(401).json({ error: "Invalid credentials" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/signup", async (req, res) => {
    const { companyName, country, defaultCurrency, adminName, adminEmail } = req.body;
    const companyId = `comp-${Date.now()}`;
    const adminId = `u-${Date.now()}`;

    try {
      await pool.execute(
        "INSERT INTO companies (id, name, default_currency, country) VALUES (?, ?, ?, ?)",
        [companyId, companyName, defaultCurrency, country]
      );

      await pool.execute(
        "INSERT INTO users (id, name, email, role, company_id, department) VALUES (?, ?, ?, ?, ?, ?)",
        [adminId, adminName, adminEmail, "Admin", companyId, "Administration"]
      );

      // Default rules
      const ruleId = `r-${Date.now()}`;
      const defaultRule = {
        id: ruleId,
        name: "Default Approval",
        description: "Initial approval flow",
        flowType: "Sequential",
        isManagerApproverAtStart: true,
        steps: [
          { role: "Manager", isManagerApprover: true, isRequired: true },
          { role: "Finance", isManagerApprover: false, isRequired: true }
        ]
      };

      await pool.execute(
        "INSERT INTO approval_rules (id, company_id, steps_json) VALUES (?, ?, ?)",
        [ruleId, companyId, JSON.stringify(defaultRule)]
      );

      res.json({ companyId, adminId, role: "Admin" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/company/:id", async (req, res) => {
    try {
      const [companies] = await pool.execute("SELECT * FROM companies WHERE id = ?", [req.params.id]) as any[];
      const company = companies[0];
      if (!company) return res.status(404).json({ error: "Company not found" });

      const [rules] = await pool.execute("SELECT * FROM approval_rules WHERE company_id = ?", [req.params.id]) as any[];
      res.json({ 
        ...mapCompany(company), 
        rules: rules.map((r: any) => typeof r.steps_json === 'string' ? JSON.parse(r.steps_json) : r.steps_json) 
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/approval-rules", async (req, res) => {
    const { companyId, rules } = req.body;
    try {
      await pool.execute("DELETE FROM approval_rules WHERE company_id = ?", [companyId]);
      for (const rule of rules) {
        await pool.execute(
          "INSERT INTO approval_rules (id, company_id, steps_json) VALUES (?, ?, ?)",
          [rule.id, companyId, JSON.stringify(rule)]
        );
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/users", async (req, res) => {
    const { name, email, role, managerId, companyId, department } = req.body;
    const id = `u-${Date.now()}`;
    try {
      await pool.execute(
        "INSERT INTO users (id, name, email, role, manager_id, company_id, department) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, name, email, role, managerId || null, companyId, department]
      );
      res.json({ id, name, email, role, managerId, companyId, department });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/users", async (req, res) => {
    const { companyId, managerId } = req.query;
    try {
      let users: any[];
      if (companyId) {
        [users] = await pool.execute("SELECT * FROM users WHERE company_id = ?", [companyId]) as any[];
      } else if (managerId) {
        [users] = await pool.execute("SELECT * FROM users WHERE manager_id = ?", [managerId]) as any[];
      } else {
        [users] = await pool.execute("SELECT * FROM users") as any[];
      }
      res.json(users.map(mapUser));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/expenses", async (req, res) => {
    const { employeeId, managerId } = req.query;
    try {
      let expenses: any[];
      if (employeeId) {
        [expenses] = await pool.execute(
          "SELECT e.*, u.name as employeeName FROM expenses e JOIN users u ON e.employee_id = u.id WHERE e.employee_id = ?",
          [employeeId]
        ) as any[];
      } else if (managerId) {
        [expenses] = await pool.execute(
          "SELECT e.*, u.name as employeeName FROM expenses e JOIN users u ON e.employee_id = u.id WHERE u.manager_id = ?",
          [managerId]
        ) as any[];
      } else {
        [expenses] = await pool.execute(
          "SELECT e.*, u.name as employeeName FROM expenses e JOIN users u ON e.employee_id = u.id"
        ) as any[];
      }
      res.json(expenses.map(mapExpense));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/expenses", async (req, res) => {
    const { employeeId, amount, currency, baseAmount, category, description, date } = req.body;
    const id = `e-${Date.now()}`;
    try {
      await pool.execute(
        "INSERT INTO expenses (id, employee_id, amount, currency, base_amount, category, description, date, status, current_step) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0)",
        [id, employeeId, amount, currency, baseAmount, category, description, date]
      );
      res.json({ id, status: 'Pending' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/stats", async (req, res) => {
    const { employeeId, managerId, companyId } = req.query;
    try {
      let stats: any;
      if (employeeId) {
        const [rows] = await pool.execute(`
          SELECT 
            SUM(CASE WHEN status = 'Approved' THEN base_amount ELSE 0 END) as totalSpent,
            SUM(CASE WHEN status = 'Pending' THEN base_amount ELSE 0 END) as totalPending,
            SUM(CASE WHEN status = 'Rejected' THEN base_amount ELSE 0 END) as totalRejected,
            COUNT(*) as totalCount
          FROM expenses 
          WHERE employee_id = ?
        `, [employeeId]) as any[];
        stats = rows[0];
      } else if (managerId) {
        const [rows] = await pool.execute(`
          SELECT 
            SUM(CASE WHEN e.status = 'Approved' THEN e.base_amount ELSE 0 END) as totalSpent,
            SUM(CASE WHEN e.status = 'Pending' THEN e.base_amount ELSE 0 END) as totalPending,
            SUM(CASE WHEN e.status = 'Rejected' THEN e.base_amount ELSE 0 END) as totalRejected,
            COUNT(*) as totalCount
          FROM expenses e
          JOIN users u ON e.employee_id = u.id
          WHERE u.manager_id = ?
        `, [managerId]) as any[];
        stats = rows[0];
      } else if (companyId) {
        const [rows] = await pool.execute(`
          SELECT 
            SUM(CASE WHEN e.status = 'Approved' THEN e.base_amount ELSE 0 END) as totalSpent,
            SUM(CASE WHEN e.status = 'Pending' THEN e.base_amount ELSE 0 END) as totalPending,
            SUM(CASE WHEN e.status = 'Rejected' THEN e.base_amount ELSE 0 END) as totalRejected,
            COUNT(*) as totalCount
          FROM expenses e
          JOIN users u ON e.employee_id = u.id
          WHERE u.company_id = ?
        `, [companyId]) as any[];
        stats = rows[0];
      }
      
      if (stats) {
        stats.totalSpent = Number(stats.totalSpent || 0);
        stats.totalPending = Number(stats.totalPending || 0);
        stats.totalRejected = Number(stats.totalRejected || 0);
        stats.totalCount = Number(stats.totalCount || 0);
      }
      
      res.json(stats || { totalSpent: 0, totalPending: 0, totalRejected: 0, totalCount: 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/approvals/pending", async (req, res) => {
    try {
      const [expenses]: any[] = await pool.execute(`
        SELECT e.*, u.name as employeeName 
        FROM expenses e 
        JOIN users u ON e.employee_id = u.id 
        WHERE e.status = 'Pending'
      `);
      res.json(expenses.map(mapExpense));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/approvals/action", async (req, res) => {
    const { expenseId, userId, role, action, comment } = req.body;
    const date = new Date().toISOString().split('T')[0];
    const logId = `l-${Date.now()}`;
    
    try {
      await pool.execute(
        "INSERT INTO approval_logs (id, expense_id, approver_id, role, status, comment, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [logId, expenseId, userId, role, action === 'approve' ? 'Approved' : 'Rejected', comment, date]
      );

      if (action === 'reject') {
        await pool.execute("UPDATE expenses SET status = 'Rejected' WHERE id = ?", [expenseId]);
      } else {
        const [expenses] = await pool.execute("SELECT * FROM expenses WHERE id = ?", [expenseId]) as any[];
        const expense = expenses[0];
        const [rules] = await pool.execute("SELECT * FROM approval_rules WHERE company_id = ?", ['comp-1']) as any[];
        const rule = rules[0];
        const steps = typeof rule.steps_json === 'string' ? JSON.parse(rule.steps_json).steps : rule.steps_json.steps;
        
        if (expense.current_step >= steps.length - 1) {
          await pool.execute("UPDATE expenses SET status = 'Approved' WHERE id = ?", [expenseId]);
        } else {
          await pool.execute("UPDATE expenses SET current_step = current_step + 1 WHERE id = ?", [expenseId]);
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/users/:id/promote", async (req, res) => {
    const { id } = req.params;
    try {
      await pool.execute("UPDATE users SET role = 'Manager' WHERE id = ?", [id]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/users/:id/assign-director", async (req, res) => {
    const { id } = req.params;
    const { directorId } = req.body;
    try {
      await pool.execute("UPDATE users SET manager_id = ? WHERE id = ?", [directorId, id]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/company/:id", async (req, res) => {
    const { id } = req.params;
    const { name, country, defaultCurrency } = req.body;
    try {
      await pool.execute(
        "UPDATE companies SET name = ?, country = ?, default_currency = ? WHERE id = ?",
        [name, country, defaultCurrency, id]
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
