/**
 * Departments and subjects for the dummy data.
 * CS subjects come from the official timetable. Everything else is a realistic PLACEHOLDER
 * and will be replaced by the college's real subject list.
 */
export type CourseKind = "INTEGRATED" | "THEORY_ONLY" | "SPECIALIZATION";

export interface SubjectDef {
  shortName: string;
  name: string;
  kind: CourseKind;
  /** Shared subjects (Maths, EVS, Kannada) are taught by the common Science & Humanities pool. */
  pool?: "MATHS" | "EVS" | "KANNADA";
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

const MATHS: SubjectDef = { shortName: "MATHS", name: "Engineering Mathematics", kind: "INTEGRATED", pool: "MATHS" };
const EVS: SubjectDef = { shortName: "EVS", name: "Environmental Studies", kind: "THEORY_ONLY", pool: "EVS" };
const KAN: SubjectDef = { shortName: "KANNADA", name: "Kannada", kind: "THEORY_ONLY", pool: "KANNADA" };
const ITS: SubjectDef = { shortName: "IT SKILLS", name: "IT Skills", kind: "INTEGRATED" };
const FEEE: SubjectDef = { shortName: "FEEE", name: "Fundamentals of Electrical & Electronics Engineering", kind: "INTEGRATED" };
const integrated = (shortName: string, name: string): SubjectDef => ({ shortName, name, kind: "INTEGRATED" });
const spec = (area: string): SubjectDef[] => [{ shortName: "SPECIALIZATION", name: `Programme Specialization (${area})`, kind: "SPECIALIZATION" }];

/** Subjects in timetable order S1..S5 (see timetables.ts). */
export const SUBJECTS: Record<DeptCode, Record<1 | 3 | 5, SubjectDef[]>> = {
  CS: {
    1: [MATHS, integrated("BDLCO", "BDLCO"), FEEE, ITS, EVS],
    3: [integrated("DSP", "DSP"), integrated("S&NA", "S&NA"), integrated("DC&T", "DC&T"), integrated("CN", "Computer Networks"), KAN],
    5: spec("Cyber Security"),
  },
  CG: {
    1: [MATHS, integrated("BDLCO", "BDLCO"), FEEE, ITS, EVS],
    3: [integrated("PYTHON", "Python Programming"), integrated("LINUX", "Linux Administration"), integrated("CCF", "Cloud Computing Fundamentals"), integrated("CN", "Computer Networks"), KAN],
    5: spec("Cloud Infrastructure"),
  },
  CE: {
    1: [MATHS, integrated("CM", "Construction Materials"), integrated("BS", "Basic Surveying"), ITS, EVS],
    3: [integrated("SOM", "Strength of Materials"), integrated("AS", "Advanced Surveying"), integrated("BC", "Building Construction"), integrated("CT", "Concrete Technology"), KAN],
    5: spec("Construction Management"),
  },
  ME: {
    1: [MATHS, integrated("ED", "Engineering Drawing"), integrated("WP", "Workshop Practice"), ITS, EVS],
    3: [integrated("TE", "Thermal Engineering"), integrated("MP", "Manufacturing Processes"), integrated("MD", "Machine Drawing"), integrated("SOM", "Strength of Materials"), KAN],
    5: spec("Automobile Engineering"),
  },
  EE: {
    1: [MATHS, FEEE, integrated("BEW", "Basic Electrical Workshop"), ITS, EVS],
    3: [integrated("EM", "Electrical Machines"), integrated("ECA", "Electric Circuit Analysis"), integrated("PE", "Power Electronics"), integrated("EMI", "Electrical Measurements"), KAN],
    5: spec("Renewable Energy"),
  },
  EC: {
    1: [MATHS, FEEE, integrated("BDE", "Basic Digital Electronics"), ITS, EVS],
    3: [integrated("ADC", "Analog & Digital Communication"), integrated("MCU", "Microcontrollers"), integrated("EDC", "Electronic Devices & Circuits"), integrated("NA", "Network Analysis"), KAN],
    5: spec("Embedded Systems"),
  },
  EI: {
    1: [MATHS, FEEE, integrated("BDE", "Basic Digital Electronics"), ITS, EVS],
    3: [integrated("TRD", "Transducers"), integrated("MI", "Measurements & Instrumentation"), integrated("PC", "Process Control"), integrated("EDC", "Electronic Devices & Circuits"), KAN],
    5: spec("Industrial Automation"),
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
