/**
 * Departments and subjects for the dummy data.
 *
 * CS, EC, ME and EE Sem 1 and Sem 3 use the real C-25 subjects (DTE Karnataka, from AY 2025-26; see
 * docs/c25-subjects.md). Sem 5 is still C-20 (students admitted in 2024): CS has its real specialization,
 * the rest are PLACEHOLDERS, like every CE / EI / Cloud Computing subject (syllabus not received yet).
 */
export type CourseKind = "INTEGRATED" | "THEORY_ONLY" | "SPECIALIZATION";

export interface SubjectDef {
  /** Official code. Shared subjects (Maths 25SC11I) have the same code in every department. */
  code: string;
  shortName: string;
  name: string;
  kind: CourseKind;
  /** Final exam: theory (4-0-4 courses), practical (3-0-4 courses), or none (audit courses). */
  see: "THEORY" | "PRACTICAL" | null;
  /** Shared subjects are taught by the common Science & Humanities pool, not the department. */
  pool?: "MATHS" | "ENGLISH" | "EVS" | "KANNADA";
}

export const DEPARTMENTS = [
  { code: "CE", name: "Civil Engineering (General)" },
  { code: "CS", name: "Computer Science & Engineering" },
  { code: "EE", name: "Electrical & Electronics Engineering" },
  { code: "EC", name: "Electronics & Communication Engineering" },
  { code: "EI", name: "Electronics Instrumentation & Control Engineering" },
  { code: "ME", name: "Mechanical Engineering (General)" },
  { code: "CG", name: "Cloud Computing" },
] as const;

export type DeptCode = (typeof DEPARTMENTS)[number]["code"];

const theory = (code: string, shortName: string, name: string, pool?: SubjectDef["pool"]): SubjectDef => ({ code, shortName, name, kind: "INTEGRATED", see: "THEORY", pool });
const practical = (code: string, shortName: string, name: string, pool?: SubjectDef["pool"]): SubjectDef => ({ code, shortName, name, kind: "INTEGRATED", see: "PRACTICAL", pool });
const audit = (code: string, shortName: string, name: string, pool: SubjectDef["pool"]): SubjectDef => ({ code, shortName, name, kind: "THEORY_ONLY", see: null, pool });

// Shared C-25 courses.
const MATHS_1 = theory("25SC11I", "MATHS", "Engineering Mathematics-I", "MATHS");
const IT_SKILLS = practical("25CS01I", "IT SKILLS", "IT Skills");
const FEEE = practical("25EE01I", "FEEE", "Fundamentals of Electrical & Electronics Engineering");
const ENGLISH = practical("25EG01I", "ENGLISH", "Essential English Communication", "ENGLISH");
const CAEG = practical("25ME02I", "CAEG", "Computer Aided Engineering Graphics");
const envSus = (dept: string) => audit(`25${dept}12T`, "EVS", "Environmental Sustainability", "EVS");
const KANNADA_1 = audit("25KA31T", "KANNADA", "Kannada-I (Sahitya Sinchana-I / Balake Kannada-I)", "KANNADA");

/** Placeholder subject (department syllabus not received yet). */
const ph = (dept: string, sem: number, i: number, shortName: string, name: string, see: "THEORY" | "PRACTICAL"): SubjectDef => ({
  code: `${dept}${sem}-0${i}`,
  shortName,
  name: `${name} (placeholder)`,
  kind: "INTEGRATED",
  see,
});
const spec = (dept: string, area: string): SubjectDef[] => [
  { code: `${dept}5-01`, shortName: "SPECIALIZATION", name: `Programme Specialization (${area})`, kind: "SPECIALIZATION", see: "PRACTICAL" },
];

/**
 * Subjects in timetable order S1..S5 (see timetables.ts). Sem 1: S1 Maths, S2 the department's 4-0-4
 * course, S3/S4 the 3-0-4 courses, S5 the audit course. Sem 3 follows the official CS grid: S1/S2 the
 * 3-0-4 (practical exam) courses, S3/S4 the 4-0-4 (theory exam) ones, S5 Kannada.
 */
export const SUBJECTS: Record<DeptCode, Record<1 | 3 | 5, SubjectDef[]>> = {
  CS: {
    1: [MATHS_1, theory("25CS11I", "BDLCO", "Basics of Digital Logic and Computer Organization"), FEEE, IT_SKILLS, envSus("CS")],
    3: [
      practical("25CS33I", "DSP", "Data Structures with Python"),
      practical("25CS34I", "S&NA", "System and Network Administration"),
      theory("25CS31I", "DC&T", "Database Concepts & Technologies"),
      theory("25CS32I", "CN", "Computer Networks"),
      KANNADA_1,
    ],
    5: spec("CS", "Cyber Security"),
  },
  EC: {
    1: [MATHS_1, theory("25EC11I", "DE-I", "Digital Electronics-I"), FEEE, IT_SKILLS, envSus("EC")],
    3: [
      practical("25EC33I", "AE-II", "Applied Electronics-II"),
      practical("25EC34I", "C PROG", "C-Programming"),
      theory("25EC31I", "DE-II", "Digital Electronics-II"),
      theory("25EC32I", "COMM SYS", "Communication Systems"),
      KANNADA_1,
    ],
    5: spec("EC", "Embedded Systems"),
  },
  ME: {
    1: [MATHS_1, theory("25ME11I", "MEP-I", "Mechanical Engineering Practices-I"), practical("25ME01I", "CAED", "Computer Aided Engineering Drawing"), ENGLISH, envSus("ME")],
    3: [
      practical("25ME33I", "FPE", "Fluid Power Engineering"),
      practical("25ME34I", "PCME", "Programming Concepts in Mechanical Engineering"),
      theory("25ME31I", "MOM", "Mechanics of Materials"),
      theory("25ME32I", "TE", "Thermal Engineering"),
      KANNADA_1,
    ],
    5: spec("ME", "Automobile Engineering"),
  },
  EE: {
    1: [MATHS_1, theory("25EE11I", "BET", "Basic Electrical Technology"), FEEE, CAEG, envSus("EE")],
    3: [
      practical("25EE33I", "G&T", "Generators & Transformers"),
      practical("25EE34I", "ADE", "Analog and Digital Electronics"),
      theory("25EE31I", "GTD", "Generation, Transmission and Distribution"),
      theory("25EE32I", "S&P", "Switchgear and Protection"),
      KANNADA_1,
    ],
    5: spec("EE", "Renewable Energy"),
  },
  CE: {
    1: [MATHS_1, ph("CE", 1, 2, "CM", "Construction Materials", "THEORY"), FEEE, IT_SKILLS, envSus("CE")],
    3: [ph("CE", 3, 1, "BC", "Building Construction", "PRACTICAL"), ph("CE", 3, 2, "CT", "Concrete Technology", "PRACTICAL"), ph("CE", 3, 3, "SOM", "Strength of Materials", "THEORY"), ph("CE", 3, 4, "SURVEY", "Surveying", "THEORY"), KANNADA_1],
    5: spec("CE", "Construction Management"),
  },
  EI: {
    1: [MATHS_1, ph("EI", 1, 2, "BDE", "Basic Digital Electronics", "THEORY"), FEEE, IT_SKILLS, envSus("EI")],
    3: [ph("EI", 3, 1, "TRD", "Transducers", "PRACTICAL"), ph("EI", 3, 2, "EDC", "Electronic Devices & Circuits", "PRACTICAL"), ph("EI", 3, 3, "MI", "Measurements & Instrumentation", "THEORY"), ph("EI", 3, 4, "PC", "Process Control", "THEORY"), KANNADA_1],
    5: spec("EI", "Industrial Automation"),
  },
  CG: {
    1: [MATHS_1, ph("CG", 1, 2, "CCF", "Cloud Computing Fundamentals", "THEORY"), FEEE, IT_SKILLS, envSus("CG")],
    3: [ph("CG", 3, 1, "PYTHON", "Python Programming", "PRACTICAL"), ph("CG", 3, 2, "LINUX", "Linux Administration", "PRACTICAL"), ph("CG", 3, 3, "VIRT", "Virtualization", "THEORY"), ph("CG", 3, 4, "CN", "Computer Networks", "THEORY"), KANNADA_1],
    5: spec("CG", "Cloud Infrastructure"),
  },
};

export const FIRST_NAMES_M = [
  "Aarav", "Abhishek", "Adithya", "Akash", "Amith", "Anil", "Arjun", "Basavaraj", "Bharath", "Chandan", "Chethan", "Darshan",
  "Deepak", "Dhanush", "Ganesh", "Girish", "Gowtham", "Harsha", "Hemanth", "Jayanth", "Karthik", "Kiran", "Lohith", "Madhu",
  "Manoj", "Mohan", "Naveen", "Nikhil", "Pavan", "Prajwal", "Pradeep", "Prakash", "Pranav", "Rahul", "Rakesh", "Ravi",
  "Rohith", "Sachin", "Santhosh", "Shashank", "Shivu", "Shreyas", "Sumanth", "Suhas", "Tejas", "Vinay", "Vishnu", "Yashwanth",
];
export const FIRST_NAMES_F = [
  "Aishwarya", "Akshatha", "Ananya", "Anusha", "Apoorva", "Bhavana", "Bhoomika", "Chaitra", "Deepika", "Divya", "Harshitha",
  "Kavya", "Keerthana", "Lavanya", "Likhitha", "Meghana", "Navya", "Nisarga", "Pallavi", "Pooja", "Prarthana", "Priya",
  "Rachana", "Rakshitha", "Sahana", "Sanjana", "Shreya", "Sindhu", "Spoorthi", "Swathi", "Tanvi", "Varsha", "Vidya", "Yashaswini",
];
export const SURNAMES = [
  "Gowda", "Rao", "Shetty", "Hegde", "Patil", "Naik", "Kumar", "Reddy", "Murthy", "Prasad", "Bhat", "Kulkarni", "Desai",
  "Swamy", "Shankar", "Raju", "Nayak", "Achar", "Joshi", "Iyer", "K", "M", "S", "R", "N", "B",
];
export const STAFF_TITLES = ["Lecturer", "Senior Lecturer", "Selection Grade Lecturer"];
