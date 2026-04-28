
const value = "2026-04-28";
const d1 = new Date(`${value}T00:00:00`);
console.log("With T00:00:00:", d1.toString(), "ISO:", d1.toISOString());

const d2 = new Date(value);
console.log("Just date string:", d2.toString(), "ISO:", d2.toISOString());

const [y, m, d] = value.split('-').map(Number);
const d3 = new Date(y, m - 1, d);
console.log("Constructor:", d3.toString(), "ISO:", d3.toISOString());
