CREATE TABLE IF NOT EXISTS companies (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  default_currency VARCHAR(10) NOT NULL,
  country VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(50) NOT NULL,
  password VARCHAR(255) DEFAULT 'password123',
  manager_id VARCHAR(255),
  company_id VARCHAR(255) NOT NULL,
  department VARCHAR(255),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id VARCHAR(255) PRIMARY KEY,
  employee_id VARCHAR(255) NOT NULL,
  amount DOUBLE NOT NULL,
  currency VARCHAR(10) NOT NULL,
  base_amount DOUBLE NOT NULL,
  category VARCHAR(255) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending',
  receipt_url TEXT,
  current_step INT DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS approval_rules (
  id VARCHAR(255) PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  steps_json JSON NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS approval_logs (
  id VARCHAR(255) PRIMARY KEY,
  expense_id VARCHAR(255) NOT NULL,
  approver_id VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  comment TEXT,
  date DATE NOT NULL,
  FOREIGN KEY (expense_id) REFERENCES expenses(id),
  FOREIGN KEY (approver_id) REFERENCES users(id)
);

-- Seed Initial Data
INSERT IGNORE INTO companies (id, name, default_currency, country) VALUES ('comp-1', 'Acme Corp', 'USD', 'United States');

INSERT IGNORE INTO users (id, name, email, role, manager_id, company_id, department, password) VALUES 
('u-1', 'Alice Admin', 'alice@acme.com', 'Admin', null, 'comp-1', 'Administration', 'pass123'),
('u-2', 'Bob Manager', 'bob@acme.com', 'Manager', null, 'comp-1', 'Engineering', 'pass123'),
('u-3', 'Charlie Employee', 'charlie@acme.com', 'Employee', 'u-2', 'comp-1', 'Engineering', 'pass123'),
('u-4', 'Diana Finance', 'diana@acme.com', 'Finance', null, 'comp-1', 'Finance', 'pass123'),
('u-5', 'Frank Manager', 'manager1@acme.com', 'Manager', null, 'comp-1', 'Operations', 'pass123'),
('u-6', 'Grace Manager', 'manager2@acme.com', 'Manager', null, 'comp-1', 'Product', 'pass123'),
('u-7', 'Henry Employee', 'emp1@acme.com', 'Employee', 'u-5', 'comp-1', 'Engineering', 'pass123'),
('u-8', 'Ivy Employee', 'emp2@acme.com', 'Employee', 'u-5', 'comp-1', 'Sales', 'pass123'),
('u-9', 'Jack Employee', 'emp3@acme.com', 'Employee', 'u-6', 'comp-1', 'Support', 'pass123');

INSERT IGNORE INTO approval_rules (id, company_id, steps_json) VALUES 
('r-1', 'comp-1', '{"id": "r-1", "name": "Standard Approval", "description": "Default approval flow", "flowType": "Sequential", "isManagerApproverAtStart": true, "steps": [{"role": "Manager", "isManagerApprover": true, "isRequired": true}, {"role": "Finance", "isManagerApprover": false, "percentageRequired": 100, "isRequired": true}]}');

-- Seed Mock Expenses
INSERT IGNORE INTO expenses (id, employee_id, amount, currency, base_amount, category, description, date, status, current_step) VALUES 
('e-1', 'u-3', 150.50, 'EUR', 165.55, 'Travel', 'Taxi to airport', '2026-03-25', 'Pending', 0),
('e-2', 'u-3', 45.00, 'USD', 45.00, 'Meals', 'Client lunch', '2026-03-24', 'Approved', 2),
('e-3', 'u-3', 200.00, 'USD', 200.00, 'Office', 'Monitor stand', '2026-03-23', 'Rejected', 0),
('e-4', 'u-2', 1200.00, 'USD', 1200.00, 'Equipment', 'Laptop repair', '2026-03-22', 'Pending', 0);

-- Seed Approval Logs
INSERT IGNORE INTO approval_logs (id, expense_id, approver_id, role, status, comment, date) VALUES 
('l-1', 'e-2', 'u-2', 'Manager', 'Approved', 'Looks good', '2026-03-24'),
('l-2', 'e-2', 'u-4', 'Finance', 'Approved', 'Receipt verified', '2026-03-25');
