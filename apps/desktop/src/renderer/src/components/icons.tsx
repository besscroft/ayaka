import type { SVGProps } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  Brain,
  Bug,
  Check,
  CheckSquare,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  Code2,
  Clock,
  CornerDownLeft,
  Cpu,
  Copy,
  Database,
  Download,
  DollarSign,
  GitFork,
  Globe,
  FolderOpen,
  Hand,
  History,
  Image,
  Info,
  Key,
  LayoutDashboard,
  Link,
  List,
  MessageSquare,
  MoreHorizontal,
  Moon,
  Monitor,
  Minus,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Square,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Sun,
  Trash2,
  Terminal,
  Type,
  Wrench,
  X,
  Zap,
  Eye,
  Unlock,
  type LucideIcon,
} from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;

function fromLucide(Icon: LucideIcon) {
  return (props: IconProps): React.JSX.Element => <Icon {...props} />;
}

export const IconPlus = fromLucide(Plus);
export const IconTrash = fromLucide(Trash2);
export const IconPin = fromLucide(Pin);
export const IconSettings = fromLucide(Settings);
export const IconSun = fromLucide(Sun);
export const IconMoon = fromLucide(Moon);
export const IconMonitor = fromLucide(Monitor);
export const IconMinimize = fromLucide(Minus);
export const IconMaximize = fromLucide(Square);
export const IconRestore = fromLucide(Copy);
export const IconSidebarCollapse = fromLucide(PanelLeftClose);
export const IconSidebarExpand = fromLucide(PanelLeftOpen);
export const IconPanelRightClose = fromLucide(PanelRightClose);
export const IconPanelRightOpen = fromLucide(PanelRightOpen);
export const IconSend = fromLucide(Send);
export const IconArrowUp = fromLucide(ArrowUp);
export const IconArrowDown = fromLucide(ArrowDown);
export const IconDots = fromLucide(MoreHorizontal);
export const IconWrench = fromLucide(Wrench);
export const IconCircleCheck = fromLucide(CircleCheck);
export const IconCircleX = fromLucide(CircleX);
export const IconCode = fromLucide(Code2);
export const IconCircleDashed = fromLucide(CircleDashed);
export const IconBrain = fromLucide(Brain);
export const IconMessage = fromLucide(MessageSquare);
export const IconKey = fromLucide(Key);
export const IconCheck = fromLucide(Check);
export const IconClose = fromLucide(X);
export const IconX = fromLucide(X);
export const IconChevronDown = fromLucide(ChevronDown);
export const IconPalette = fromLucide(Palette);
export const IconInfo = fromLucide(Info);
export const IconSliders = fromLucide(SlidersHorizontal);
export const IconCpu = fromLucide(Cpu);
export const IconTerminal = fromLucide(Terminal);
export const IconHand = fromLucide(Hand);
export const IconShieldAlert = fromLucide(ShieldAlert);
export const IconUnlock = fromLucide(Unlock);
export const IconRotateCcw = fromLucide(RotateCcw);
export const IconGlobe = fromLucide(Globe);
export const IconFolderOpen = fromLucide(FolderOpen);
export const IconClock = fromLucide(Clock);
export const IconDatabase = fromLucide(Database);
export const IconDownload = fromLucide(Download);
export const IconType = fromLucide(Type);
export const IconLayout = fromLucide(LayoutDashboard);
export const IconSearch = fromLucide(Search);
export const IconSmile = fromLucide(Smile);
export const IconPaperclip = fromLucide(Paperclip);
export const IconCopy = fromLucide(Copy);
export const IconRefresh = fromLucide(RefreshCw);
export const IconEdit = fromLucide(Pencil);
export const IconSend2 = fromLucide(CornerDownLeft);
export const IconImage = fromLucide(Image);
export const IconList = fromLucide(List);
export const IconChartBar = fromLucide(BarChart3);
export const IconCurrency = fromLucide(DollarSign);
export const IconCheckSquare = fromLucide(CheckSquare);
export const IconCircle = fromLucide(Circle);
export const IconLink = fromLucide(Link);
export const IconGitFork = fromLucide(GitFork);
export const IconBookOpen = fromLucide(BookOpen);
export const IconBug = fromLucide(Bug);
export const IconHistory = fromLucide(History);
export const IconStatusDot = (props: IconProps): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    aria-hidden
    {...props}
    fill="currentColor"
    stroke="none"
  >
    <circle cx="12" cy="12" r="5" />
  </svg>
);
export const IconZap = fromLucide(Zap);
export const IconSparkles = fromLucide(Sparkles);
export const IconEye = fromLucide(Eye);
