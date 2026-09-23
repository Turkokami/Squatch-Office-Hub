// Generate a password hash for OFFICE_USERS.
// Usage:  node scripts/hash-password.mjs "the password"
// Output: <salt>:<key>  — paste it into the OFFICE_USERS environment variable.
// The plain password is never stored anywhere in this project.

import crypto from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "the password"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const key = crypto.scryptSync(password, salt, 64).toString("hex");
console.log(`${salt}:${key}`);
