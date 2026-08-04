import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";

interface AirportRecord {
  id: number;
  ident: string; // ICAO or FAA LID
  iata: string | null;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number | null;
  type: string;
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to download airports.csv: ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const airports: AirportRecord[] = [];
  for (const row of rows.slice(1)) {
    const iata = row[idx.iata_code] || null;
    const type = row[idx.type];
    if (!iata) continue; // keep dataset small: IATA-coded airports only
    airports.push({
      id: Number(row[idx.id]),
      ident: row[idx.ident],
      iata,
      name: row[idx.name],
      lat: Number(row[idx.latitude_deg]),
      lon: Number(row[idx.longitude_deg]),
      elevationFt: row[idx.elevation_ft] ? Number(row[idx.elevation_ft]) : null,
      type,
    });
  }

  const out = path.join(__dirname, "..", "server", "data", "airports.json");
  writeFileSync(out, JSON.stringify(airports, null, 0));
  console.log(`Wrote ${airports.length} airports to ${out}`);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
