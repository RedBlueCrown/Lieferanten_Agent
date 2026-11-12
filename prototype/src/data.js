window.LLV_DATA = (function () {
const VERTRAGSARTEN = ['Rahmenvertrag', 'Einzelvertrag', 'AVV', 'SaaS-Vertrag', 'Wartung/Support (SLA)', 'Beratung/Dienstleistung', 'NDA'];
const KLASSEN = { A: 'A (strategisch, Level 3+4 Anwendungen)', B: 'B (Standard, Level 2 Anwendungen)', C: 'C (unkritisch, Level 0+1 Anwendungen)' };
const LEVELS = { L0: 'L0 (SaaS, Kundenbetreut)', L1: 'L1 (OnPrem, Kundenbetreut)', L2: 'L2 (Minimalbetreut)', L3: 'L3 (Individualbetreut)', L4: 'L4 (Voll betreut)' };
const BEWERTUNG = ['Top', 'OK', 'Mangelhaft', 'Nicht relevant'];
const KADENZ = ['A (1-2 x jährlich)', 'B (1 x jährlich)', 'C (bei Bedarf)'];
const KPI = [
  { gruppe: 'Zuverlässigkeit', items: [['liefertermine', 'Einhaltung der vereinbarten Liefertermine'], ['agilitaet', 'Reaktionsfähigkeit bei kurzfristigen Änderungen (Agilität)'], ['qualitaet', 'Techn. Qualität der gelieferten Software (Releasezyklen, Sev. Patches etc.)']] },
  { gruppe: 'Kostenstruktur', items: [['preise', 'Stabilität der Preise'], ['zusatzkosten', 'Zusatzkosten (nicht im Vertrag inkludiert)'], ['stundensaetze', 'Stundensätze (LLV-konform)']] },
  { gruppe: 'Service, Support und Governance', items: [['erreichbarkeit', 'Erreichbarkeit und Reaktionszeiten'], ['fachkunde', 'Fachkundige Unterstützung bei techn. oder fachlichen Problemen (Requirement Coverage)'], ['doku', 'Bereitstellung von Dokumentationen und Schulungen'], ['proaktiv', 'Proaktive Kommunikation von Verbesserungsmöglichkeiten'], ['ticketing', 'Ticketingsystem (LLV-System, eigenes System angebunden)'], ['eskalation', 'Eskalationspfad'], ['meetings', 'Regelmässige Meetings (Kadenz, Teilnehmer), abhängig von Bedeutung', 'kadenz']] }
];
const RISIKO = [['rechtsform', 'Gesellschaftsform (AG, GmbH, SA, …)'], ['finanzen', 'Einschätzung finanzieller Stabilität'], ['mitarbeiter', 'Anzahl Mitarbeiter und die Veränderung zum Vorjahr'], ['kunden', 'Anzahl Kunden und die Veränderung zum Vorjahr'], ['strategie', 'Strategie der Unternehmung'], ['reifegrad', 'Techn. Reifegrad (Innovationsbereitschaft)'], ['abhaengigkeit', 'Einschätzung der Abhängigkeit vom Lieferanten (Monopolstellung, …)'], ['nachfolge', 'Nachfolgeregelung'], ['exit', 'Exit-Strategie']];

const P = ['Lieferantenmanager', 'Beschaffung', 'Jurist'];
const PERS = { ib: 'I. Büchel', mf: 'M. Frick', sh: 'S. Hasler', rk: 'R. Kaiser', aw: 'A. Wohlwend', tm: 'T. Marxer', cb: 'C. Beck', ns: 'N. Schädler' };

function k(o) { const r = {}; Object.keys(o).forEach(x => r[x] = { wert: o[x][0], begr: o[x][1] || '' }); return r; }

const LIEFERANTEN = [
  { id: 'L-1001', name: 'Rheinwerk Informatik AG', ort: 'Vaduz', land: 'FL', rechtsform: 'AG', klasse: 'A', kontakt: 'Peter Ospelt', mail: 'p.ospelt@rheinwerk.li', telefone: [{ art: 'Zentrale', nr: '+423 231 01 00' }, { art: 'Direkt', nr: '+423 791 41 11' }], tel: '+423 237 41 00',
    vertraege: [
      { id: 'V-2201', typ: 'Rahmenvertrag', titel: 'Rahmenvertrag Steuerapplikation eTax', beginn: '2022-04-01', ende: '2027-03-31', kuendigungsfrist: 6, autoVerl: 12, review: '2026-11-30', wert: 420000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Rheinwerk/RV_eTax_2022.pdf', anmerkung: 'Preisverhandlung 2027 vorbereiten' },
      { id: 'V-2202', typ: 'Wartung/Support (SLA)', titel: 'Wartung & Support eTax', beginn: '2022-04-01', ende: '2027-03-31', kuendigungsfrist: 6, autoVerl: 12, review: '2026-11-30', wert: 96000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Rheinwerk/SLA_eTax_2022.pdf', anmerkung: 'Verfügbarkeit 99.7 %' },
      { id: 'V-2203', typ: 'AVV', titel: 'Auftragsverarbeitung eTax', beginn: '2022-04-01', ende: '', kuendigungsfrist: 0, autoVerl: 0, review: '2027-04-01', wert: 0, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Rheinwerk/AVV_eTax_2022.pdf', anmerkung: '' }
    ],
    apps: [{ name: 'eTax Natürliche Personen', level: 'L4', betrieb: PERS.mf, fach: 'Steuerverwaltung, ' + PERS.rk, kontakt: 'Peter Ospelt', anm: '' }, { name: 'eTax Juristische Personen', level: 'L3', betrieb: PERS.mf, fach: 'Steuerverwaltung, ' + PERS.rk, kontakt: 'Peter Ospelt', anm: '' }],
    kpi: k({ liefertermine: ['Top'], agilitaet: ['OK'], qualitaet: ['Top', 'Patches innert 48 h'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['Top'], fachkunde: ['Top'], doku: ['OK'], proaktiv: ['OK'], ticketing: ['Top', 'LLV-Jira angebunden'], eskalation: ['Top'], meetings: ['A (1-2 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['OK'], mitarbeiter: ['OK', '86 MA (+4)'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['Top'], abhaengigkeit: ['Mangelhaft', 'Einziger Anbieter mit eTax-Know-how'], nachfolge: ['OK'], exit: ['Mangelhaft', 'Keine dokumentierte Exit-Strategie'] }),
    massnahmen: 'Hohe Abhängigkeit. Exit-Strategie bis Q2 2027 erarbeiten; Quellcode-Hinterlegung (Escrow) prüfen.' },
  { id: 'L-1002', name: 'Alpina Cloud Services GmbH', ort: 'Zürich', land: 'CH', rechtsform: 'GmbH', klasse: 'A', kontakt: 'Sandra Keller', mail: 's.keller@alpina-cloud.ch', telefone: [{ art: 'Zentrale', nr: '+423 232 02 00' }, { art: 'Direkt', nr: '+423 792 42 12' }], tel: '+41 44 512 30 30',
    vertraege: [
      { id: 'V-2210', typ: 'SaaS-Vertrag', titel: 'Hosting Bürgerportal', beginn: '2024-01-01', ende: '2026-12-31', kuendigungsfrist: 3, autoVerl: 36, review: '2026-10-15', wert: 185000, gerichtsstand: 'Zürich', recht: 'CH', status: 'Aktiv', ablage: 'Verträge/Alpina/SaaS_Buergerportal_2024.pdf', anmerkung: 'Auto-Verlängerung 36 Monate' }
    ],
    apps: [{ name: 'Bürgerportal', level: 'L3', betrieb: PERS.sh, fach: 'Amt für Informatik, ' + PERS.aw, kontakt: 'Sandra Keller', anm: '' }],
    kpi: k({ liefertermine: ['OK'], agilitaet: ['Mangelhaft', 'Änderungen dauern > 6 Wochen'], qualitaet: ['OK'], preise: ['Mangelhaft', '+7 % 2026'], zusatzkosten: ['Mangelhaft'], stundensaetze: ['Nicht relevant'], erreichbarkeit: ['OK'], fachkunde: ['OK'], doku: ['OK'], proaktiv: ['Mangelhaft'], ticketing: ['OK'], eskalation: ['OK'], meetings: ['A (1-2 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'GmbH'], finanzen: ['OK'], mitarbeiter: ['OK'], kunden: ['Top'], strategie: ['OK'], reifegrad: ['Top'], abhaengigkeit: ['OK'], nachfolge: ['Nicht relevant'], exit: ['OK'] }),
    massnahmen: 'Kein AVV vorhanden – umgehend nachfordern. Kündigungsfrist vor Auto-Verlängerung verpasst; Verhandlung Sonderkündigung.' },
  { id: 'L-1003', name: 'Taxis Solutions AG', ort: 'Schaan', land: 'FL', rechtsform: 'AG', klasse: 'A', kontakt: 'Marco Vogt', mail: 'm.vogt@taxis.li', telefone: [{ art: 'Zentrale', nr: '+423 233 03 00' }, { art: 'Direkt', nr: '+423 793 43 13' }], tel: '+423 232 18 18',
    vertraege: [
      { id: 'V-2220', typ: 'Wartung/Support (SLA)', titel: 'Betrieb Fahrzeugregister', beginn: '2021-07-01', ende: '2027-06-30', kuendigungsfrist: 6, autoVerl: 12, review: '2027-01-15', wert: 132000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Taxis/SLA_Fahrzeugregister.pdf', anmerkung: '' },
      { id: 'V-2221', typ: 'AVV', titel: 'Auftragsverarbeitung Fahrzeugregister', beginn: '2021-07-01', ende: '', kuendigungsfrist: 0, autoVerl: 0, review: '2026-12-01', wert: 0, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Taxis/AVV_Fahrzeugregister.pdf', anmerkung: '' }
    ],
    apps: [{ name: 'Fahrzeugregister', level: 'L4', betrieb: PERS.tm, fach: 'Motorfahrzeugkontrolle, ' + PERS.cb, kontakt: 'Marco Vogt', anm: '' }],
    kpi: k({ liefertermine: ['OK'], agilitaet: ['OK'], qualitaet: ['OK'], preise: ['Top'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['OK'], fachkunde: ['Top'], doku: ['Mangelhaft', 'Betriebshandbuch veraltet'], proaktiv: ['OK'], ticketing: ['OK'], eskalation: ['OK'], meetings: ['A (1-2 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['OK'], mitarbeiter: ['Mangelhaft', '14 MA (−3)'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['OK'], abhaengigkeit: ['Mangelhaft'], nachfolge: ['Mangelhaft', 'Inhaber 64, keine Regelung'], exit: ['OK'] }),
    massnahmen: 'Nachfolgeregelung beim nächsten Jahresgespräch thematisieren.' },
  { id: 'L-1004', name: 'Gamprin Netzwerk AG', ort: 'Gamprin', land: 'FL', rechtsform: 'AG', klasse: 'A', kontakt: 'Lukas Hoop', mail: 'l.hoop@gamprin-netz.li', telefone: [{ art: 'Zentrale', nr: '+423 234 04 00' }, { art: 'Direkt', nr: '+423 794 44 14' }], tel: '+423 373 00 50',
    vertraege: [
      { id: 'V-2230', typ: 'Rahmenvertrag', titel: 'Rahmenvertrag Netzwerk & Infrastruktur', beginn: '2023-01-01', ende: '2027-12-31', kuendigungsfrist: 6, autoVerl: 12, review: '2027-03-01', wert: 310000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Gamprin/RV_Netzwerk_2023.pdf', anmerkung: '' },
      { id: 'V-2231', typ: 'Einzelvertrag', titel: 'Erneuerung WLAN Regierungsgebäude', beginn: '2026-03-01', ende: '2026-12-15', kuendigungsfrist: 1, autoVerl: 0, review: '', wert: 78000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: '', anmerkung: 'Abnahme geplant Dezember' }
    ],
    apps: [{ name: 'LAN/WLAN Landesverwaltung', level: 'L3', betrieb: PERS.mf, fach: 'Amt für Informatik, ' + PERS.mf, kontakt: 'Lukas Hoop', anm: '' }],
    kpi: k({ liefertermine: ['Top'], agilitaet: ['Top'], qualitaet: ['Nicht relevant'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['Top'], fachkunde: ['Top'], doku: ['OK'], proaktiv: ['Top'], ticketing: ['OK'], eskalation: ['OK'], meetings: ['A (1-2 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['Top'], mitarbeiter: ['OK'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['OK'], abhaengigkeit: ['OK'], nachfolge: ['OK'], exit: ['OK'] }),
    massnahmen: '' },
  { id: 'L-1005', name: 'Medicus Soft AG', ort: 'St. Gallen', land: 'CH', rechtsform: 'AG', klasse: 'B', kontakt: 'Andrea Baumann', mail: 'a.baumann@medicus-soft.ch', telefone: [{ art: 'Zentrale', nr: '+423 235 05 00' }, { art: 'Direkt', nr: '+423 795 45 15' }], tel: '+41 71 228 44 10',
    vertraege: [
      { id: 'V-2240', typ: 'SaaS-Vertrag', titel: 'Fallführung Amtsärztlicher Dienst', beginn: '2025-02-01', ende: '2027-01-31', kuendigungsfrist: 3, autoVerl: 12, review: '2026-12-10', wert: 54000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Medicus/SaaS_Fallfuehrung.pdf', anmerkung: '' },
      { id: 'V-2241', typ: 'AVV', titel: 'AVV Gesundheitsdaten', beginn: '2025-02-01', ende: '', kuendigungsfrist: 0, autoVerl: 0, review: '2027-02-01', wert: 0, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Medicus/AVV_2025.pdf', anmerkung: '' }
    ],
    apps: [{ name: 'Fallführung ÄD', level: 'L2', betrieb: PERS.sh, fach: 'Amt für Gesundheit, ' + PERS.ns, kontakt: 'Andrea Baumann', anm: '' }],
    kpi: k({ liefertermine: ['OK'], agilitaet: ['OK'], qualitaet: ['OK'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['Nicht relevant'], erreichbarkeit: ['OK'], fachkunde: ['OK'], doku: ['OK'], proaktiv: ['OK'], ticketing: ['OK'], eskalation: ['OK'], meetings: ['B (1 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['OK'], mitarbeiter: ['OK'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['OK'], abhaengigkeit: ['OK'], nachfolge: ['OK'], exit: ['OK'] }),
    massnahmen: '' },
  { id: 'L-1006', name: 'Sigma Geodaten AG', ort: 'Chur', land: 'CH', rechtsform: 'AG', klasse: 'B', kontakt: 'Reto Casutt', mail: 'r.casutt@sigma-geo.ch', telefone: [{ art: 'Zentrale', nr: '+423 236 06 00' }, { art: 'Direkt', nr: '+423 796 46 16' }], tel: '+41 81 250 70 70',
    vertraege: [
      { id: 'V-2250', typ: 'Wartung/Support (SLA)', titel: 'Wartung Geoportal', beginn: '2020-01-01', ende: '2026-12-31', kuendigungsfrist: 3, autoVerl: 12, review: '2026-09-30', wert: 41000, gerichtsstand: 'Chur', recht: 'CH', status: 'Aktiv', ablage: 'Verträge/Sigma/Wartung_Geoportal.pdf', anmerkung: 'Review überfällig' }
    ],
    apps: [{ name: 'Geoportal', level: 'L2', betrieb: PERS.tm, fach: 'Amt für Tiefbau und Geoinformation, ' + PERS.cb, kontakt: 'Reto Casutt', anm: '' }],
    kpi: k({ liefertermine: ['OK'], agilitaet: ['OK'], qualitaet: ['Mangelhaft', 'Mehrere Regressionsfehler 2026'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['Mangelhaft'], fachkunde: ['OK'], doku: ['OK'], proaktiv: ['OK'], ticketing: ['OK'], eskalation: ['Mangelhaft', 'Kein Eskalationspfad definiert'], meetings: ['B (1 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['OK'], mitarbeiter: ['OK'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['OK'], abhaengigkeit: ['OK'], nachfolge: ['OK'], exit: ['OK'] }),
    massnahmen: 'Qualitätsgespräch terminieren; Eskalationspfad vertraglich ergänzen.' },
  { id: 'L-1007', name: 'Nordlicht Software GmbH', ort: 'München', land: 'DE', rechtsform: 'GmbH', klasse: 'B', kontakt: 'Jonas Weber', mail: 'j.weber@nordlicht-software.de', telefone: [{ art: 'Zentrale', nr: '+423 237 07 00' }, { art: 'Direkt', nr: '+423 797 47 17' }], tel: '+49 89 21 09 330',
    vertraege: [
      { id: 'V-2260', typ: 'SaaS-Vertrag', titel: 'Personalzeiterfassung', beginn: '2025-07-01', ende: '2028-06-30', kuendigungsfrist: 6, autoVerl: 12, review: '2027-06-01', wert: 67000, gerichtsstand: 'München', recht: 'DE', status: 'Aktiv', ablage: 'Verträge/Nordlicht/SaaS_Zeiterfassung.pdf', anmerkung: 'Deutsches Recht akzeptiert (Ausnahme)' }
    ],
    apps: [{ name: 'Zeiterfassung LLV', level: 'L2', betrieb: '', fach: 'Amt für Personal, ' + PERS.ib, kontakt: 'Jonas Weber', anm: 'Betriebsverantwortung offen' }],
    kpi: k({}), risiko: k({}), massnahmen: '' },
  { id: 'L-1008', name: 'Kronos HR Systeme GmbH', ort: 'Wien', land: 'AT', rechtsform: 'GmbH', klasse: 'B', kontakt: 'Eva Gruber', mail: 'e.gruber@kronos-hr.at', telefone: [{ art: 'Zentrale', nr: '+423 238 08 00' }, { art: 'Direkt', nr: '+423 798 48 18' }], tel: '+43 1 890 22 00',
    vertraege: [
      { id: 'V-2270', typ: 'Wartung/Support (SLA)', titel: 'Wartung Lohnsoftware', beginn: '2019-01-01', ende: '2027-02-28', kuendigungsfrist: 3, autoVerl: 12, review: '2026-12-01', wert: 58000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Kronos/Wartung_Lohn.pdf', anmerkung: 'Ablösung geprüft' }
    ],
    apps: [{ name: 'Lohnbuchhaltung', level: 'L3', betrieb: PERS.mf, fach: 'Amt für Personal, ' + PERS.ib, kontakt: 'Eva Gruber', anm: '' }],
    kpi: k({ liefertermine: ['OK'], agilitaet: ['OK'], qualitaet: ['OK'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['OK'], fachkunde: ['OK'], doku: ['OK'], proaktiv: ['OK'], ticketing: ['OK'], eskalation: ['OK'], meetings: ['B (1 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'GmbH'], finanzen: ['Mangelhaft', 'Verlust 2025'], mitarbeiter: ['OK'], kunden: ['Mangelhaft', 'Kundenrückgang −12 %'], strategie: ['OK'], reifegrad: ['OK'], abhaengigkeit: ['OK'], nachfolge: ['OK'], exit: ['OK'] }),
    massnahmen: 'Finanzielle Lage beobachten; Marktabklärung Alternativen.' },
  { id: 'L-1009', name: 'Lumen Analytics AG', ort: 'Balzers', land: 'FL', rechtsform: 'AG', klasse: 'B', kontakt: 'Nina Wolfinger', mail: 'n.wolfinger@lumen.li', telefone: [{ art: 'Zentrale', nr: '+423 239 09 00' }, { art: 'Direkt', nr: '+423 799 49 19' }], tel: '+423 388 12 12',
    vertraege: [
      { id: 'V-2280', typ: 'SaaS-Vertrag', titel: 'BI-Plattform Statistik', beginn: '2026-01-01', ende: '2028-12-31', kuendigungsfrist: 6, autoVerl: 12, review: '2027-09-01', wert: 49000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Lumen/SaaS_BI.pdf', anmerkung: '' },
      { id: 'V-2281', typ: 'AVV', titel: 'AVV Statistikdaten', beginn: '2026-01-01', ende: '', kuendigungsfrist: 0, autoVerl: 0, review: '2027-09-01', wert: 0, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Lumen/AVV_2026.pdf', anmerkung: '' }
    ],
    apps: [{ name: 'Statistikportal', level: 'L2', betrieb: PERS.sh, fach: 'Amt für Statistik, ' + PERS.ns, kontakt: 'Nina Wolfinger', anm: '' }],
    kpi: k({ liefertermine: ['Top'], agilitaet: ['Top'], qualitaet: ['OK'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['OK'], fachkunde: ['OK'], doku: ['OK'], proaktiv: ['Top'], ticketing: ['OK'], eskalation: ['OK'], meetings: ['B (1 x jährlich)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['OK'], mitarbeiter: ['OK'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['Top'], abhaengigkeit: ['OK'], nachfolge: ['OK'], exit: ['OK'] }),
    massnahmen: '' },
  { id: 'L-1010', name: 'Novalis Consulting GmbH', ort: 'Feldkirch', land: 'AT', rechtsform: 'GmbH', klasse: 'C', kontakt: 'Thomas Moser', mail: 't.moser@novalis.at', telefone: [{ art: 'Zentrale', nr: '+423 2310 010 00' }, { art: 'Direkt', nr: '+423 7910 410 110' }], tel: '+43 5522 31 400',
    vertraege: [
      { id: 'V-2290', typ: 'NDA', titel: 'Geheimhaltung Strategieprojekt', beginn: '2026-08-01', ende: '2029-07-31', kuendigungsfrist: 0, autoVerl: 0, review: '', wert: 0, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Novalis/NDA_2026.pdf', anmerkung: '' }
    ],
    apps: [], kpi: k({ liefertermine: ['OK'], agilitaet: ['Top'], qualitaet: ['Nicht relevant'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['Mangelhaft', 'Über LLV-Ansätzen'], erreichbarkeit: ['OK'], fachkunde: ['Top'], doku: ['OK'], proaktiv: ['OK'], ticketing: ['Nicht relevant'], eskalation: ['Nicht relevant'], meetings: ['C (bei Bedarf)'] }),
    risiko: k({ rechtsform: ['OK', 'GmbH'], finanzen: ['OK'], mitarbeiter: ['OK'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['Nicht relevant'], abhaengigkeit: ['Top'], nachfolge: ['Nicht relevant'], exit: ['Nicht relevant'] }),
    massnahmen: '' },
  { id: 'L-1011', name: 'Helvetia Scan & Print AG', ort: 'Buchs SG', land: 'CH', rechtsform: 'AG', klasse: 'C', kontakt: 'Beat Schlegel', mail: 'b.schlegel@hsp.ch', telefone: [{ art: 'Zentrale', nr: '+423 2311 011 00' }, { art: 'Direkt', nr: '+423 7911 411 111' }], tel: '+41 81 755 60 60',
    vertraege: [
      { id: 'V-2300', typ: 'Einzelvertrag', titel: 'Digitalisierung Archivbestände 2026', beginn: '2026-02-01', ende: '2027-01-31', kuendigungsfrist: 1, autoVerl: 0, review: '2026-12-20', wert: 36500, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/HSP/EV_Archiv_2026.pdf', anmerkung: '' }
    ],
    apps: [{ name: 'Scanstrasse Archiv', level: 'L1', betrieb: PERS.tm, fach: 'Landesarchiv, ' + PERS.aw, kontakt: 'Beat Schlegel', anm: '' }],
    kpi: k({ liefertermine: ['OK'], agilitaet: ['OK'], qualitaet: ['Nicht relevant'], preise: ['Top'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['OK'], fachkunde: ['OK'], doku: ['OK'], proaktiv: ['OK'], ticketing: ['Nicht relevant'], eskalation: ['OK'], meetings: ['C (bei Bedarf)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['OK'], mitarbeiter: ['OK'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['OK'], abhaengigkeit: ['Top'], nachfolge: ['OK'], exit: ['OK'] }),
    massnahmen: '' },
  { id: 'L-1012', name: 'Brücke Datenschutzpartner AG', ort: 'Eschen', land: 'FL', rechtsform: 'AG', klasse: 'C', kontakt: 'Lea Meier', mail: 'l.meier@bruecke-ds.li', telefone: [{ art: 'Zentrale', nr: '+423 2312 012 00' }, { art: 'Direkt', nr: '+423 7912 412 112' }], tel: '+423 375 90 90',
    vertraege: [
      { id: 'V-2310', typ: 'Beratung/Dienstleistung', titel: 'Datenschutzberatung DSFA', beginn: '2026-01-01', ende: '2026-12-31', kuendigungsfrist: 1, autoVerl: 0, review: '2026-11-20', wert: 24000, gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/Bruecke/Beratung_2026.pdf', anmerkung: 'Verlängerung 2027 geplant' }
    ],
    apps: [], kpi: k({ liefertermine: ['Top'], agilitaet: ['Top'], qualitaet: ['Nicht relevant'], preise: ['OK'], zusatzkosten: ['OK'], stundensaetze: ['OK'], erreichbarkeit: ['Top'], fachkunde: ['Top'], doku: ['OK'], proaktiv: ['OK'], ticketing: ['Nicht relevant'], eskalation: ['Nicht relevant'], meetings: ['C (bei Bedarf)'] }),
    risiko: k({ rechtsform: ['OK', 'AG'], finanzen: ['OK'], mitarbeiter: ['OK'], kunden: ['OK'], strategie: ['OK'], reifegrad: ['Nicht relevant'], abhaengigkeit: ['Top'], nachfolge: ['OK'], exit: ['Nicht relevant'] }),
    massnahmen: '' }
];

// ---------- Prüfstandards (Quelle: Word-Dokument je Vertragsart in SharePoint) ----------
const KLAUSELN = {
  rangfolge: { titel: 'Rangfolge der Vertragsbestandteile', ok: 'LLV-Vertrag geht Anhängen vor; AGB des Lieferanten sind ausgeschlossen.', verh: 'AGB des Lieferanten gelten nachrangig, soweit sie dem Vertrag nicht widersprechen.', nicht: 'AGB des Lieferanten gehen dem Vertrag vor oder werden ohne Prüfung integriert.', muster: 'Es gelten in nachstehender Rangfolge: (1) dieser Vertrag, (2) seine Anhänge, (3) das Angebot des Lieferanten. Allgemeine Geschäftsbedingungen des Lieferanten finden keine Anwendung.' },
  abruf: { titel: 'Abrufverfahren', ok: 'Leistungen werden per Einzelvertrag oder Bestellung abgerufen; kein Mindestabnahmevolumen.', verh: 'Unverbindliches Zielvolumen ohne finanzielle Folgen.', nicht: 'Verbindliche Mindestabnahme oder Ausgleichszahlung bei Unterschreitung.', muster: 'Die LLV ruft Leistungen bei Bedarf mittels Einzelvertrag ab. Eine Abnahmepflicht besteht nicht.' },
  laufzeit: { titel: 'Laufzeit und Verlängerung', ok: 'Feste Laufzeit von höchstens 3 Jahren; stillschweigende Verlängerung um höchstens 12 Monate.', verh: 'Automatische Verlängerung um 13 bis 24 Monate, sofern die Kündigungsfrist höchstens 6 Monate beträgt.', nicht: 'Automatische Verlängerung um mehr als 24 Monate oder Mindestlaufzeit über 5 Jahre ohne Ausstiegsmöglichkeit.', muster: 'Der Vertrag tritt mit Unterzeichnung in Kraft und gilt für eine feste Dauer von [Laufzeit]. Danach verlängert er sich jeweils um 12 Monate, sofern er nicht fristgerecht gekündigt wird.' },
  kuendigung: { titel: 'Kündigung', ok: 'Ordentliche Kündigung durch die LLV mit höchstens 6 Monaten Frist auf Monatsende; ausserordentliche Kündigung aus wichtigem Grund jederzeit.', verh: 'Kündigungsfrist 6 bis 12 Monate oder Kündigung nur auf Jahresende.', nicht: 'Kündigungsfrist über 12 Monate, kein ausserordentliches Kündigungsrecht oder einseitiges Kündigungsrecht nur des Lieferanten.', muster: 'Jede Partei kann den Vertrag unter Einhaltung einer Frist von [Frist] Monaten auf das Ende eines Monats schriftlich kündigen. Das Recht zur Kündigung aus wichtigem Grund bleibt vorbehalten.' },
  verguetung: { titel: 'Vergütung und Preisanpassung', ok: 'Fixpreise; Anpassung höchstens einmal jährlich, gekoppelt an den Landesindex der Konsumentenpreise, maximal 3 %, mit 3 Monaten Ankündigung.', verh: 'Anpassung bis 5 % pro Jahr mit Ankündigung.', nicht: 'Einseitige Preisanpassung ohne Obergrenze oder ohne Sonderkündigungsrecht der LLV.', muster: 'Die Vergütung beträgt [Betrag] exkl. MWST. Eine Anpassung ist frühestens nach 12 Monaten, höchstens einmal jährlich und maximal im Umfang der Veränderung des Landesindex der Konsumentenpreise, höchstens jedoch 3 %, zulässig.' },
  haftung: { titel: 'Haftung', ok: 'Haftung mindestens in Höhe des Jahresvertragswerts; unbeschränkt bei Vorsatz, grober Fahrlässigkeit und Personenschäden.', verh: 'Begrenzung auf 50–100 % des Jahresvertragswerts.', nicht: 'Begrenzung unter 50 % des Jahresvertragswerts, Ausschluss bei grober Fahrlässigkeit oder Ausschluss der Haftung für Datenverlust.', muster: 'Die Parteien haften für Schäden bis zur Höhe des jährlichen Vertragswerts, mindestens jedoch CHF 100\u2019000. Für Vorsatz, grobe Fahrlässigkeit sowie Personenschäden ist die Haftung unbeschränkt.' },
  datenschutz: { titel: 'Datenschutz und Datenstandort', ok: 'Verarbeitung gemäss DSGVO (EWR) und liechtensteinischem DSG; AVV abgeschlossen; Datenhaltung in FL, CH oder EWR.', verh: 'Datenhaltung ausserhalb des EWR mit Angemessenheitsbeschluss und Standardvertragsklauseln.', nicht: 'Datenhaltung in Drittstaaten ohne Garantien oder Nutzung von LLV-Daten für eigene Zwecke (z. B. KI-Training).', muster: 'Der Lieferant verarbeitet Personendaten ausschliesslich im Auftrag der LLV und nach Massgabe der Auftragsverarbeitungsvereinbarung. Die Daten werden ausschliesslich in Rechenzentren in Liechtenstein, der Schweiz oder im EWR gespeichert.' },
  geheim: { titel: 'Geheimhaltung und Amtsgeheimnis', ok: 'Umfassende Geheimhaltungspflicht inkl. Hinweis auf das Amtsgeheimnis; gilt unbefristet über das Vertragsende hinaus.', verh: 'Geheimhaltung befristet auf mindestens 5 Jahre nach Vertragsende.', nicht: 'Keine Geheimhaltungsklausel oder Dauer unter 5 Jahren.', muster: 'Der Lieferant verpflichtet sich, sämtliche Informationen, die ihm im Rahmen dieses Vertrags bekannt werden, vertraulich zu behandeln. Er nimmt zur Kenntnis, dass diese dem Amtsgeheimnis unterliegen können. Die Pflicht gilt über das Vertragsende hinaus.' },
  ip: { titel: 'Nutzungs- und Schutzrechte', ok: 'Rechte an Individualentwicklungen gehen an die LLV über; an Standardsoftware unbefristetes, nicht-exklusives Nutzungsrecht.', verh: 'Bei SaaS Nutzungsrecht auf Vertragsdauer; Arbeitsergebnisse mit einfachem Nutzungsrecht.', nicht: 'Rechte an LLV-Daten oder an Arbeitsergebnissen verbleiben ausschliesslich beim Lieferanten.', muster: 'Sämtliche Rechte an Arbeitsergebnissen, die eigens für die LLV erstellt werden, gehen mit ihrer Entstehung auf die LLV über. Die Daten der LLV bleiben in deren Eigentum.' },
  sla_verf: { titel: 'Verfügbarkeit', ok: 'Mindestens 99.5 % pro Monat, Reporting monatlich durch den Lieferanten.', verh: '99.0 % bis 99.5 % pro Monat.', nicht: 'Unter 99.0 % oder keine verbindliche Verfügbarkeitszusage.', muster: 'Der Lieferant gewährleistet eine Verfügbarkeit von mindestens 99.5 % pro Kalendermonat, gemessen am Übergabepunkt. Er rapportiert die Verfügbarkeit monatlich.' },
  sla_reakt: { titel: 'Reaktions- und Lösungszeiten', ok: 'P1: Reaktion ≤ 1 h, Lösung ≤ 4 h; P2: Reaktion ≤ 4 h, Lösung ≤ 1 Arbeitstag; Servicezeit Mo–Fr 07.00–18.00 Uhr.', verh: 'P1: Reaktion ≤ 4 h, Lösung ≤ 1 Arbeitstag.', nicht: 'Keine verbindlichen Zeiten oder lediglich «best effort».', muster: 'Für Störungen gelten folgende Zeiten: Priorität 1 – Reaktion innert 1 Stunde, Lösung oder Umgehung innert 4 Stunden; Priorität 2 – Reaktion innert 4 Stunden, Lösung innert 1 Arbeitstag.' },
  sla_poenale: { titel: 'Service Credits', ok: 'Gutschriften bei SLA-Verletzung, mind. 5 % der Monatsgebühr je angefangene 0.5 % Unterschreitung; Sonderkündigungsrecht bei wiederholter Verletzung.', verh: 'Gutschriften gedeckelt auf 10 % der Monatsgebühr.', nicht: 'Keine Rechtsfolgen bei SLA-Verletzung.', muster: 'Bei Unterschreitung der vereinbarten Verfügbarkeit schreibt der Lieferant je angefangene 0.5 % Unterschreitung 5 % der Monatsgebühr gut. Bei Unterschreitung in drei aufeinanderfolgenden Monaten kann die LLV den Vertrag fristlos kündigen.' },
  exit: { titel: 'Exit und Datenrückgabe', ok: 'Rückgabe aller Daten in einem Standardformat innert 30 Tagen, Migrationsunterstützung zu vertraglichen Ansätzen, Löschbestätigung.', verh: 'Rückgabe innert 90 Tagen oder kostenpflichtig nach Aufwand.', nicht: 'Keine Rückgabepflicht oder nur in proprietärem Format.', muster: 'Bei Vertragsende übergibt der Lieferant der LLV sämtliche Daten innert 30 Tagen in einem gängigen, maschinenlesbaren Format und bestätigt anschliessend schriftlich deren Löschung.' },
  subunt: { titel: 'Beizug von Subunternehmern', ok: 'Nur mit vorgängiger schriftlicher Zustimmung der LLV; Liste im Anhang.', verh: 'Informationspflicht mit Widerspruchsrecht der LLV innert 30 Tagen.', nicht: 'Freier Beizug ohne Information der LLV.', muster: 'Der Beizug von Subunternehmern bedarf der vorgängigen schriftlichen Zustimmung der LLV. Die genehmigten Subunternehmer sind in Anhang 2 aufgeführt.' },
  tom: { titel: 'Technische und organisatorische Massnahmen', ok: 'TOM im Anhang beschrieben; Zertifizierung (z. B. ISO 27001) mit jährlichem Nachweis.', verh: 'TOM allgemein beschrieben, Nachweis auf Anfrage.', nicht: 'Keine TOM beschrieben.', muster: 'Der Auftragsverarbeiter trifft die in Anhang 1 beschriebenen technischen und organisatorischen Massnahmen und weist deren Wirksamkeit jährlich nach.' },
  meldung: { titel: 'Meldung von Datenschutzverletzungen', ok: 'Unverzüglich, spätestens innert 24 Stunden.', verh: 'Innert 48 Stunden.', nicht: 'Später als 72 Stunden oder keine Meldepflicht.', muster: 'Der Auftragsverarbeiter meldet der LLV Verletzungen des Schutzes personenbezogener Daten unverzüglich, spätestens innert 24 Stunden nach Kenntnisnahme.' },
  audit: { titel: 'Kontroll- und Auditrechte', ok: 'Audit durch die LLV oder beauftragte Dritte nach Ankündigung.', verh: 'Nur Vorlage aktueller Zertifikate und Prüfberichte.', nicht: 'Kontrollrechte ausgeschlossen.', muster: 'Die LLV ist berechtigt, die Einhaltung dieser Vereinbarung nach vorgängiger Ankündigung selbst oder durch beauftragte Dritte zu überprüfen.' },
  stundensatz: { titel: 'Stundensätze und Spesen', ok: 'Gemäss LLV-Ansätzen (Senior max. CHF 180/h, Junior max. CHF 130/h); Reisezeit und Spesen nicht verrechenbar.', verh: 'Bis 10 % über LLV-Ansätzen mit Begründung.', nicht: 'Mehr als 10 % über LLV-Ansätzen oder pauschale Reisezeit-/Spesenverrechnung.', muster: 'Die Leistungen werden nach effektivem Aufwand zu folgenden Ansätzen verrechnet: Senior CHF 180.–/h, Junior CHF 130.–/h, jeweils exkl. MWST. Reisezeit und Spesen sind in den Ansätzen enthalten.' },
  personal: { titel: 'Schlüsselpersonen', ok: 'Benannte Schlüsselpersonen; Wechsel nur mit Zustimmung der LLV.', verh: 'Wechsel mit vorgängiger Information und gleichwertigem Ersatz.', nicht: 'Keine Regelung zu Schlüsselpersonen.', muster: 'Der Lieferant setzt die in Anhang 1 genannten Schlüsselpersonen ein. Ein Wechsel bedarf der vorgängigen Zustimmung der LLV.' },
  abnahme: { titel: 'Abnahme und Gewährleistung', ok: 'Schriftliche Abnahme durch die LLV; Gewährleistung 12 Monate ab Abnahme.', verh: 'Gewährleistung 6 Monate.', nicht: 'Abnahmefiktion nach weniger als 10 Arbeitstagen oder Ausschluss der Gewährleistung.', muster: 'Die Leistungen gelten erst mit schriftlicher Abnahme durch die LLV als erbracht. Die Gewährleistungsfrist beträgt 12 Monate ab Abnahme.' },
  konvstrafe: { titel: 'Konventionalstrafe', ok: 'CHF 20\u2019000 je Verletzung, weitergehender Schadenersatz vorbehalten.', verh: 'CHF 5\u2019000 bis 20\u2019000 je Verletzung.', nicht: 'Keine Konventionalstrafe.', muster: 'Bei Verletzung der Geheimhaltungspflicht schuldet die verletzende Partei eine Konventionalstrafe von CHF 20\u2019000 je Fall. Die Geltendmachung weiteren Schadens bleibt vorbehalten.' },
  recht: { titel: 'Anwendbares Recht und Gerichtsstand', ok: 'Liechtensteinisches Recht; ausschliesslicher Gerichtsstand Vaduz.', verh: 'Schweizer Recht mit Gerichtsstand Vaduz oder Schiedsgericht mit Sitz in Liechtenstein.', nicht: 'Ausländisches Recht oder Gerichtsstand ausserhalb Liechtensteins.', muster: 'Dieser Vertrag untersteht liechtensteinischem Recht unter Ausschluss des Kollisionsrechts. Ausschliesslicher Gerichtsstand ist Vaduz.' }
};
const STANDARD_KLAUSELN = {
  'Rahmenvertrag': ['rangfolge', 'abruf', 'laufzeit', 'kuendigung', 'verguetung', 'haftung', 'geheim', 'datenschutz', 'recht'],
  'Einzelvertrag': ['rangfolge', 'laufzeit', 'verguetung', 'abnahme', 'haftung', 'ip', 'geheim', 'recht'],
  'AVV': ['datenschutz', 'subunt', 'tom', 'meldung', 'audit', 'exit', 'recht'],
  'SaaS-Vertrag': ['rangfolge', 'laufzeit', 'kuendigung', 'verguetung', 'sla_verf', 'datenschutz', 'exit', 'haftung', 'ip', 'recht'],
  'Wartung/Support (SLA)': ['laufzeit', 'kuendigung', 'verguetung', 'sla_verf', 'sla_reakt', 'sla_poenale', 'haftung', 'recht'],
  'Beratung/Dienstleistung': ['stundensatz', 'personal', 'abnahme', 'ip', 'haftung', 'geheim', 'kuendigung', 'recht'],
  'NDA': ['geheim', 'konvstrafe', 'laufzeit', 'recht']
};
const STANDARD_META = {
  'Rahmenvertrag': { version: '2.3', geaendert: '2026-09-12', von: 'Dr. K. Batliner' },
  'Einzelvertrag': { version: '1.8', geaendert: '2026-05-04', von: 'Dr. K. Batliner' },
  'AVV': { version: '3.1', geaendert: '2026-10-02', von: 'lic. iur. S. Risch' },
  'SaaS-Vertrag': { version: '2.0', geaendert: '2026-08-21', von: 'Dr. K. Batliner' },
  'Wartung/Support (SLA)': { version: '1.6', geaendert: '2026-03-17', von: 'lic. iur. S. Risch' },
  'Beratung/Dienstleistung': { version: '1.4', geaendert: '2026-06-30', von: 'Dr. K. Batliner' },
  'NDA': { version: '1.2', geaendert: '2025-11-11', von: 'lic. iur. S. Risch' }
};

// ---------- Prüfaufträge (Lieferantenpapier) ----------
const PRUEFAUFTRAEGE = [
  { id: 'P-301', lieferantId: 'L-1002', lieferant: 'Alpina Cloud Services GmbH', typ: 'SaaS-Vertrag', titel: 'Hosting Bürgerportal – Verlängerung 2027', eingang: '2026-11-03', frist: '2026-11-13', von: 'Beschaffung, ' + PERS.cb, quelle: 'Lieferantenpapier', status: 'In Prüfung',
    klauseln: [
      { titel: '§ 1 Geltung', text: 'Es gelten die Allgemeinen Geschäftsbedingungen der Alpina Cloud Services GmbH in der jeweils gültigen Fassung. Sie gehen abweichenden Bestimmungen dieses Vertrags vor.' },
      { titel: '§ 3 Laufzeit', text: 'Der Vertrag wird für 36 Monate abgeschlossen und verlängert sich jeweils um weitere 36 Monate, sofern er nicht 3 Monate vor Ablauf gekündigt wird.' },
      { titel: '§ 4 Kündigung', text: 'Eine ordentliche Kündigung ist mit einer Frist von 3 Monaten auf das Ende eines Kalenderjahres möglich. Das Recht zur ausserordentlichen Kündigung aus wichtigem Grund bleibt unberührt.' },
      { titel: '§ 5 Preise', text: 'Der Anbieter ist berechtigt, die Preise jährlich um bis zu 7 % anzupassen. Die Anpassung wird 30 Tage im Voraus angekündigt.' },
      { titel: '§ 6 Service Level', text: 'Der Anbieter stellt eine Verfügbarkeit von 99.0 % im Jahresmittel bereit. Geplante Wartungsfenster werden nicht angerechnet.' },
      { titel: '§ 7 Datenschutz', text: 'Die Daten werden in Rechenzentren in Frankfurt (DE) gespeichert. Für Support-Leistungen können Subunternehmer in den USA beigezogen werden; es gelten die EU-Standardvertragsklauseln.' },
      { titel: '§ 8 Datenrückgabe', text: 'Nach Vertragsende werden die Kundendaten während 30 Tagen im Format JSON/CSV zum Download bereitgestellt und anschliessend gelöscht.' },
      { titel: '§ 9 Haftung', text: 'Die Haftung des Anbieters ist auf die in den letzten drei Monaten bezahlten Gebühren beschränkt. Die Haftung für Datenverlust ist ausgeschlossen.' },
      { titel: '§ 10 Rechte', text: 'Der Kunde erhält für die Vertragsdauer ein nicht-exklusives Nutzungsrecht an der Plattform. Die Kundendaten verbleiben im Eigentum des Kunden.' },
      { titel: '§ 12 Recht und Gerichtsstand', text: 'Es gilt Schweizer Recht. Gerichtsstand ist Zürich.' }
    ] },
  { id: 'P-302', lieferantId: 'L-1010', lieferant: 'Novalis Consulting GmbH', typ: 'Beratung/Dienstleistung', titel: 'Beratung Digitalisierungsstrategie 2027', eingang: '2026-11-05', frist: '2026-11-19', von: 'Beschaffung, ' + PERS.cb, quelle: 'Lieferantenpapier', status: 'In Prüfung',
    klauseln: [
      { titel: '1. Honorar', text: 'Die Leistungen werden nach Aufwand verrechnet: Partner CHF 260/h, Senior Consultant CHF 210/h, Consultant CHF 150/h. Reisezeit wird zu 50 % verrechnet, Spesen pauschal mit 8 % des Honorars.' },
      { titel: '2. Projektteam', text: 'Das Projekt wird von Thomas Moser (Partner) und Julia Ritter (Senior Consultant) geleitet. Ein Wechsel erfolgt nach Information des Auftraggebers.' },
      { titel: '3. Abnahme', text: 'Arbeitsergebnisse gelten als abgenommen, wenn der Auftraggeber nicht innert 5 Arbeitstagen nach Übergabe schriftlich widerspricht.' },
      { titel: '4. Urheberrechte', text: 'Sämtliche Urheberrechte an Konzepten, Methoden und Unterlagen verbleiben beim Berater. Der Auftraggeber erhält ein einfaches Nutzungsrecht für interne Zwecke.' },
      { titel: '5. Haftung', text: 'Die Haftung ist auf die Höhe des Gesamthonorars beschränkt, ausgenommen Vorsatz und grobe Fahrlässigkeit.' },
      { titel: '6. Vertraulichkeit', text: 'Die Parteien behandeln vertrauliche Informationen während 3 Jahren nach Projektabschluss vertraulich.' },
      { titel: '7. Beendigung', text: 'Der Auftrag kann von beiden Parteien mit einer Frist von 30 Tagen schriftlich beendet werden.' },
      { titel: '8. Recht', text: 'Es gilt österreichisches Recht. Gerichtsstand ist Feldkirch.' }
    ] }
];

const FALLBACK_REVIEW = {
  'P-301': [
    { klausel: 'rangfolge', fundstelle: '§ 1 Geltung', ampel: 'rot', begruendung: 'AGB des Anbieters gehen dem Vertrag vor – widerspricht dem Standard (AGB ausgeschlossen).', vorschlag: KLAUSELN.rangfolge.muster },
    { klausel: 'laufzeit', fundstelle: '§ 3 Laufzeit', ampel: 'rot', begruendung: 'Automatische Verlängerung um 36 Monate übersteigt die Obergrenze von 24 Monaten.', vorschlag: 'Der Vertrag gilt für eine feste Dauer von 36 Monaten und verlängert sich danach jeweils um 12 Monate, sofern er nicht 6 Monate vor Ablauf gekündigt wird.' },
    { klausel: 'kuendigung', fundstelle: '§ 4 Kündigung', ampel: 'gelb', begruendung: 'Frist von 3 Monaten ist akzeptabel, Kündigung jedoch nur auf Jahresende möglich.', vorschlag: 'Jede Partei kann den Vertrag unter Einhaltung einer Frist von 3 Monaten auf das Ende eines Monats kündigen.' },
    { klausel: 'verguetung', fundstelle: '§ 5 Preise', ampel: 'rot', begruendung: 'Jährliche Anpassung bis 7 % ohne Indexbindung und ohne Sonderkündigungsrecht; Standard erlaubt max. 3 % (bis 5 % verhandelbar).', vorschlag: KLAUSELN.verguetung.muster },
    { klausel: 'sla_verf', fundstelle: '§ 6 Service Level', ampel: 'gelb', begruendung: '99.0 % im Jahresmittel liegt im verhandelbaren Bereich; Standard verlangt 99.5 % pro Monat.', vorschlag: KLAUSELN.sla_verf.muster },
    { klausel: 'datenschutz', fundstelle: '§ 7 Datenschutz', ampel: 'gelb', begruendung: 'Speicherung im EWR ist konform; Support-Subunternehmer in den USA nur mit Standardvertragsklauseln – verhandelbar, AVV fehlt.', vorschlag: 'Ein Zugriff aus Drittstaaten ist nur mit vorgängiger schriftlicher Zustimmung der LLV zulässig. Die Parteien schliessen eine Auftragsverarbeitungsvereinbarung ab.' },
    { klausel: 'exit', fundstelle: '§ 8 Datenrückgabe', ampel: 'gruen', begruendung: 'Rückgabe innert 30 Tagen in Standardformat entspricht dem Standard; Löschbestätigung ergänzen.', vorschlag: '' },
    { klausel: 'haftung', fundstelle: '§ 9 Haftung', ampel: 'rot', begruendung: 'Beschränkung auf 3 Monatsgebühren (ca. 25 % des Jahreswerts) und Ausschluss für Datenverlust sind nicht akzeptabel.', vorschlag: KLAUSELN.haftung.muster },
    { klausel: 'ip', fundstelle: '§ 10 Rechte', ampel: 'gruen', begruendung: 'Nutzungsrecht auf Vertragsdauer bei SaaS und Dateneigentum beim Kunden entsprechen dem Standard.', vorschlag: '' },
    { klausel: 'recht', fundstelle: '§ 12 Recht und Gerichtsstand', ampel: 'rot', begruendung: 'Schweizer Recht wäre verhandelbar, Gerichtsstand Zürich liegt jedoch ausserhalb Liechtensteins.', vorschlag: KLAUSELN.recht.muster }
  ],
  'P-302': [
    { klausel: 'stundensatz', fundstelle: '1. Honorar', ampel: 'rot', begruendung: 'Senior CHF 210/h liegt 17 % über dem LLV-Ansatz; Reisezeit und Spesenpauschale sind nicht verrechenbar.', vorschlag: KLAUSELN.stundensatz.muster },
    { klausel: 'personal', fundstelle: '2. Projektteam', ampel: 'gelb', begruendung: 'Schlüsselpersonen benannt; Wechsel nur mit Information statt Zustimmung.', vorschlag: KLAUSELN.personal.muster },
    { klausel: 'abnahme', fundstelle: '3. Abnahme', ampel: 'rot', begruendung: 'Abnahmefiktion nach 5 Arbeitstagen unterschreitet die Mindestfrist von 10 Arbeitstagen.', vorschlag: KLAUSELN.abnahme.muster },
    { klausel: 'ip', fundstelle: '4. Urheberrechte', ampel: 'rot', begruendung: 'Rechte an eigens erstellten Arbeitsergebnissen verbleiben beim Berater.', vorschlag: KLAUSELN.ip.muster },
    { klausel: 'haftung', fundstelle: '5. Haftung', ampel: 'gruen', begruendung: 'Haftung bis Gesamthonorar, unbeschränkt bei Vorsatz und grober Fahrlässigkeit – entspricht dem Standard.', vorschlag: '' },
    { klausel: 'geheim', fundstelle: '6. Vertraulichkeit', ampel: 'rot', begruendung: 'Dauer von 3 Jahren unterschreitet die Mindestdauer von 5 Jahren; Hinweis auf Amtsgeheimnis fehlt.', vorschlag: KLAUSELN.geheim.muster },
    { klausel: 'kuendigung', fundstelle: '7. Beendigung', ampel: 'gruen', begruendung: 'Kündigungsfrist 30 Tage entspricht dem Standard.', vorschlag: '' },
    { klausel: 'recht', fundstelle: '8. Recht', ampel: 'rot', begruendung: 'Österreichisches Recht und Gerichtsstand Feldkirch sind nicht akzeptabel.', vorschlag: KLAUSELN.recht.muster }
  ]
};

// ---------- Beispielvertrag für die KI-Extraktion ----------
const BEISPIEL_PDF = { name: 'Supportvertrag_Medicus_Terminplanung.pdf', groesse: '412 KB', text:
`SUPPORT- UND WARTUNGSVERTRAG Nr. MS-2026-114
zwischen der Liechtensteinischen Landesverwaltung, Amt für Gesundheit, Äulestrasse 51, 9490 Vaduz (nachfolgend «LLV») und der Medicus Soft AG, Rosenbergstrasse 22, 9000 St. Gallen (nachfolgend «Lieferant»).
1. Gegenstand: Wartung und Support der Applikation «Terminplanung Impfzentrum» (Betrieb durch den Lieferanten, Minimalbetreuung).
2. Laufzeit: Der Vertrag beginnt am 1. Januar 2027 und gilt bis 31. Dezember 2028. Er verlängert sich danach stillschweigend um jeweils 12 Monate.
3. Kündigung: Jede Partei kann den Vertrag mit einer Frist von 6 Monaten auf das Ende der Laufzeit kündigen.
4. Vergütung: Pauschal CHF 28'800.– pro Jahr exkl. MWST, zahlbar quartalsweise im Voraus.
5. Service Level: Verfügbarkeit 99.5 % pro Monat; Priorität 1: Reaktion innert 2 Stunden.
6. Ansprechpartnerin Lieferant: Andrea Baumann, a.baumann@medicus-soft.ch.
7. Datenschutz: Die Parteien schliessen eine separate Auftragsverarbeitungsvereinbarung ab.
8. Anwendbares Recht ist liechtensteinisches Recht, Gerichtsstand ist Vaduz.
Vaduz, 28. Oktober 2026` };

return { VERTRAGSARTEN, KLASSEN, LEVELS, BEWERTUNG, KADENZ, KPI, RISIKO, PERS, LIEFERANTEN, KLAUSELN, STANDARD_KLAUSELN, STANDARD_META, PRUEFAUFTRAEGE, FALLBACK_REVIEW, BEISPIEL_PDF };
})();
