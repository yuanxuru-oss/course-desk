/** 教学周次中的时间点 */
export interface PeriodSlot {
  /** 节次序号,从 1 开始 */
  index: number
  /** 开始时间 HH:mm */
  start: string
  /** 结束时间 HH:mm */
  end: string
}

export type CourseColor = string

/** 行程类型:课程之外的校园活动 */
export type EventKind = 'meeting' | 'party' | 'club' | 'lecture' | 'other'

export interface EventKindMeta {
  id: EventKind
  label: string
  /** 图标用的 emoji */
  icon: string
}

/**
 * 行程 —— 课程之外的活动(学生会会议、老师开会、党会、讲座…)
 *
 * 与课程刻意区分:课程是「实心色块」,行程是「斜纹虚线块」,
 * 两者的视觉语言完全不同,不会混在一起看。
 */
export interface CourseEvent {
  id: string
  /** 标题,如「学生会例会」 */
  title: string
  /** 类型 */
  kind: EventKind
  /** 日期 YYYY-MM-DD */
  date: string
  /** 开始时间 HH:mm */
  start: string
  /** 结束时间 HH:mm */
  end: string
  /** 地点,如「学生活动中心 301」 */
  location?: string
  /** 备注 */
  detail?: string
  /** 每周重复(以 date 所在的星期为准) */
  weekly?: boolean
  /** 同步生成的备忘录 id */
  noteId?: string
  createdAt: number
  updatedAt: number
}

export interface Course {
  id: string
  /** 课程名称 */
  name: string
  teacher?: string
  /** 教室,如 "教三 302" */
  location?: string
  /** 校区,用于跨校区赶课预警 */
  campus?: string
  /** 教学楼,用于赶教室路径预警 */
  building?: string
  color?: CourseColor
  /** 起始教学周 */
  startWeek: number
  /** 结束教学周 */
  endWeek: number
  /** 单周次集合(仅这些周上课)。为空表示每周都上 */
  singleWeeks?: number[]
  /** 星期几,1=周一 … 7=周日 */
  weekday: number
  /** 起始节次 */
  period: number
  /** 连堂节数,1 表示单节 */
  periods: number
  remark?: string
  /** 课程官网 */
  website?: string
  /** 课程资料链接(课件/题库等) */
  resources?: { title: string; url: string }[]
  /** 是否只作为"每周固定作业"存在而不进课表 */
  hidden?: boolean
  /** 本课专属的提前提醒分钟数,留空则用全局设置 */
  leadMinutes?: number
  createdAt: number
  updatedAt: number
}

export type Priority = 0 | 1 | 2

export interface Homework {
  id: string
  title: string
  courseId?: string
  detail?: string
  /** 截止时间戳(ms) */
  dueAt?: number
  done: boolean
  doneAt?: number
  /** 附件 blob id 列表 */
  attachments: string[]
  /** 所属教学周 */
  week?: number
  /** 由哪个模板生成 */
  templateId?: string
  priority: Priority
  createdAt: number
  updatedAt: number
}

/** 每周固定作业模板:自动向未来滚动生成实例 */
export interface HomeworkTemplate {
  id: string
  title: string
  courseId?: string
  detail?: string
  /** 每周几提交,1=周一 … 7=周日 */
  weekday: number
  /** 截止时间 HH:mm */
  timeOfDay: string
  startWeek: number
  endWeek: number
  priority: Priority
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  title: string
  /** Markdown 正文 */
  content: string
  /** 图片 blob id 列表 */
  images: string[]
  tags: string[]
  courseId?: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/** 进入知识库的资料(笔记 / 上传文件 / OCR 结果) */
export interface KnowledgeDoc {
  id: string
  title: string
  /** 纯文本正文,知识库检索以它为准 */
  text: string
  kind: 'note' | 'upload' | 'ocr'
  courseId?: string
  /** 来源笔记 id */
  noteId?: string
  /** 图片 blob id 列表 */
  images: string[]
  tags: string[]
  createdAt: number
}

/** 知识库切片 */
export interface KnowledgeChunk {
  id: string
  docId: string
  title: string
  text: string
  courseId?: string
  /** 向量(可选,配置 embedding API 后才有) */
  embedding?: number[]
  createdAt: number
}

export interface AiConfig {
  /** openai | anthropic */
  provider: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  model: string
  embedBaseUrl: string
  embedApiKey: string
  embedModel: string
  /**
   * 通过本地服务转发(解决跨域)。
   * 智谱 / OpenAI 官方 / Groq 这类服务商不允许浏览器直连,需要开这个。
   */
  proxy?: boolean
  /** 本地服务地址,默认 http://localhost:8787 */
  proxyUrl?: string
}

export interface Settings {
  id: 'app'
  /** 学校名称(可选),显示在页头,方便区分不同学校的作息 */
  schoolName?: string
  /** 学期第一周的周一,ISO 日期 YYYY-MM-DD */
  semesterStart: string
  /** 学期总周数 */
  weekCount: number
  /** 节次时间表 */
  periods: PeriodSlot[]
  /** 课程提醒提前分钟数 */
  courseLeadMinutes: number
  /** 作业提醒提前分钟数 */
  homeworkLeadMinutes: number
  /** 每天早安推送时间 HH:mm */
  dailyDigestTime: string
  /** 早安推送开关 */
  dailyDigestEnabled: boolean
  /** 推送通道 */
  channels: { local: boolean; webpush: boolean; wechat: boolean }
  /** 微信推送:Server酱 Key */
  wechatKey: string
  /** 微信推送代理(自建 server 的 /api/wechat) */
  wechatProxy: string
  /** Web Push 服务地址 */
  pushServerUrl: string
  /** VAPID 公钥 */
  vapidPublicKey: string
  ai: AiConfig
  /** 笔记保存后自动生成 AI 总结 */
  autoSummarize: boolean
  /** OCR 语言 */
  ocrLang: string
  /** 主题 */
  theme: 'light' | 'dark'
  /** 桌面名称(侧栏页头,双击可改) */
  appName?: string
  /** 桌面头像图片的 blob id(双击可换,双击头像选图) */
  avatarId?: string
  updatedAt: number
}

export interface Reminder {
  id: string
  /** 触发时间戳 */
  fireAt: number
  title: string
  body: string
  /** 关联类型 */
  kind: 'course' | 'homework' | 'digest' | 'event' | 'custom'
  refId?: string
  /** 已触发标记,防止重复 */
  firedAt?: number
  /** 是否为跨天补发的提醒 */
  catchUp?: boolean
}

/** 已投递的提醒记录(去重) */
export interface OutboxRecord {
  id: string
  fireAt: number
  channel: string
  sentAt: number
}