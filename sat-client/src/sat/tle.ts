import { twoline2satrec, type SatRec } from "satellite.js";

export interface TleSatellite {
  catnr: number;
  name: string;
  line1: string;
  line2: string;
  satrec: SatRec;
  periodS: number;
  inclinationDeg: number;
}

export function parseTleBlock(text: string): TleSatellite[] {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const sats: TleSatellite[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
    const satrec = twoline2satrec(line1, line2);
    const catnr = Number(line1.slice(2, 7));
    const periodS = (2 * Math.PI) / satrec.no * 60;
    sats.push({
      catnr,
      name,
      line1,
      line2,
      satrec,
      periodS,
      inclinationDeg: (satrec.inclo * 180) / Math.PI,
    });
  }
  return sats;
}
