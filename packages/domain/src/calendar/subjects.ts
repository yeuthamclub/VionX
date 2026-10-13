/** GDPT 2018 subjects and educational activities (mirrors app.school_subjects). */
export interface SchoolSubject {
  code: string;
  nameVi: string;
  nameEn: string;
  gradeFrom: number;
  gradeTo: number;
}

export const SCHOOL_SUBJECTS: readonly SchoolSubject[] = [
  { code: 'TOAN', nameVi: 'Toán', nameEn: 'Mathematics', gradeFrom: 1, gradeTo: 12 },
  { code: 'TIENG_VIET', nameVi: 'Tiếng Việt', nameEn: 'Vietnamese', gradeFrom: 1, gradeTo: 5 },
  { code: 'NGU_VAN', nameVi: 'Ngữ văn', nameEn: 'Literature', gradeFrom: 6, gradeTo: 12 },
  { code: 'TIENG_ANH', nameVi: 'Tiếng Anh', nameEn: 'English', gradeFrom: 1, gradeTo: 12 },
  { code: 'DAO_DUC', nameVi: 'Đạo đức', nameEn: 'Ethics', gradeFrom: 1, gradeTo: 5 },
  {
    code: 'TNXH',
    nameVi: 'Tự nhiên và Xã hội',
    nameEn: 'Nature and Society',
    gradeFrom: 1,
    gradeTo: 3,
  },
  { code: 'KHOA_HOC', nameVi: 'Khoa học', nameEn: 'Science', gradeFrom: 4, gradeTo: 5 },
  {
    code: 'LICH_SU_DIA_LY',
    nameVi: 'Lịch sử và Địa lí',
    nameEn: 'History and Geography',
    gradeFrom: 4,
    gradeTo: 9,
  },
  {
    code: 'TIN_HOC_CONG_NGHE',
    nameVi: 'Tin học và Công nghệ',
    nameEn: 'Informatics and Technology',
    gradeFrom: 3,
    gradeTo: 5,
  },
  {
    code: 'KHTN',
    nameVi: 'Khoa học tự nhiên',
    nameEn: 'Natural Sciences',
    gradeFrom: 6,
    gradeTo: 9,
  },
  {
    code: 'GDCD',
    nameVi: 'Giáo dục công dân',
    nameEn: 'Civic Education',
    gradeFrom: 6,
    gradeTo: 9,
  },
  { code: 'TIN_HOC', nameVi: 'Tin học', nameEn: 'Informatics', gradeFrom: 6, gradeTo: 12 },
  { code: 'CONG_NGHE', nameVi: 'Công nghệ', nameEn: 'Technology', gradeFrom: 6, gradeTo: 12 },
  { code: 'LICH_SU', nameVi: 'Lịch sử', nameEn: 'History', gradeFrom: 10, gradeTo: 12 },
  { code: 'DIA_LI', nameVi: 'Địa lí', nameEn: 'Geography', gradeFrom: 10, gradeTo: 12 },
  {
    code: 'GDKT_PL',
    nameVi: 'Giáo dục kinh tế và pháp luật',
    nameEn: 'Economics and Law',
    gradeFrom: 10,
    gradeTo: 12,
  },
  { code: 'VAT_LI', nameVi: 'Vật lí', nameEn: 'Physics', gradeFrom: 10, gradeTo: 12 },
  { code: 'HOA_HOC', nameVi: 'Hoá học', nameEn: 'Chemistry', gradeFrom: 10, gradeTo: 12 },
  { code: 'SINH_HOC', nameVi: 'Sinh học', nameEn: 'Biology', gradeFrom: 10, gradeTo: 12 },
  {
    code: 'GDTC',
    nameVi: 'Giáo dục thể chất',
    nameEn: 'Physical Education',
    gradeFrom: 1,
    gradeTo: 12,
  },
  { code: 'AM_NHAC', nameVi: 'Âm nhạc', nameEn: 'Music', gradeFrom: 1, gradeTo: 12 },
  { code: 'MI_THUAT', nameVi: 'Mĩ thuật', nameEn: 'Fine Arts', gradeFrom: 1, gradeTo: 12 },
  {
    code: 'HDTN',
    nameVi: 'Hoạt động trải nghiệm, hướng nghiệp',
    nameEn: 'Experiential and Career Activities',
    gradeFrom: 1,
    gradeTo: 12,
  },
  {
    code: 'GDQP_AN',
    nameVi: 'Giáo dục quốc phòng và an ninh',
    nameEn: 'Defence and Security Education',
    gradeFrom: 10,
    gradeTo: 12,
  },
  {
    code: 'GDDP',
    nameVi: 'Nội dung giáo dục địa phương',
    nameEn: 'Local Education',
    gradeFrom: 1,
    gradeTo: 12,
  },
  { code: 'KHAC', nameVi: 'Khác', nameEn: 'Other', gradeFrom: 1, gradeTo: 12 },
];

const BY_CODE = new Map(SCHOOL_SUBJECTS.map((s) => [s.code, s]));

export function isSubjectCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** Subjects taught in a grade, in list order (timetable editor picker). */
export function subjectsForGrade(grade: number): SchoolSubject[] {
  return SCHOOL_SUBJECTS.filter((s) => grade >= s.gradeFrom && grade <= s.gradeTo);
}
