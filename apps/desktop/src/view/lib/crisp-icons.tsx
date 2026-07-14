import * as React from "react";
import type { SVGProps } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  ArrowsRightLeftIcon,
  Bars3Icon,
  BookOpenIcon,
  ChatBubbleLeftEllipsisIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleStackIcon,
  CommandLineIcon,
  CpuChipIcon,
  DocumentDuplicateIcon,
  DocumentIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  GlobeAltIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  InformationCircleIcon,
  LanguageIcon,
  LightBulbIcon,
  LinkIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PencilIcon,
  PhotoIcon,
  PlayIcon,
  PlusIcon,
  RectangleStackIcon,
  ServerIcon,
  ServerStackIcon,
  ShareIcon,
  SparklesIcon,
  Squares2X2Icon,
  TrashIcon,
  UserGroupIcon,
  UserIcon,
  UsersIcon,
  ViewColumnsIcon,
  ViewfinderCircleIcon,
  WifiIcon,
  WrenchIcon,
  WrenchScrewdriverIcon,
  XCircleIcon,
  XMarkIcon,
  Cog6ToothIcon,
  ClockIcon,
  BuildingOffice2Icon,
  CalendarIcon,
  ClipboardDocumentCheckIcon,
  CodeBracketSquareIcon,
  MinusIcon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/20/solid";

type IconSize = number | string;

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: IconSize;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
}
type HeroIcon = React.ComponentType<any>;

function withDefaults(Icon: HeroIcon): React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>> {
  return React.forwardRef<SVGSVGElement, IconProps>(function FilledIcon(
    { "aria-hidden": ariaHidden = true, size, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absoluteStrokeWidth, ...props },
    ref
  ) {
    const Hero = Icon as any;
    return <Hero ref={ref} aria-hidden={ariaHidden} width={size} height={size} {...props} />;
  });
}

function createSimpleIcon(
  render: (props: SVGProps<SVGSVGElement>, ref: React.ForwardedRef<SVGSVGElement>) => React.ReactElement
) {
  return React.forwardRef<SVGSVGElement, IconProps>(function SimpleIcon(
    { size, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absoluteStrokeWidth, ...props },
    ref
  ) {
    return render({ width: size, height: size, ...props }, ref);
  });
}

export const AlertCircle = withDefaults(ExclamationCircleIcon);
export const AlertTriangle = withDefaults(ExclamationTriangleIcon);
export const ArrowRight = withDefaults(ArrowRightIcon);
export const BookOpen = withDefaults(BookOpenIcon);
export const Bot = withDefaults(CpuChipIcon);
export const Boxes = withDefaults(Squares2X2Icon);
export const Brain = withDefaults(LightBulbIcon);
export const Building2 = withDefaults(BuildingOffice2Icon);
export const Calendar = withDefaults(CalendarIcon);
export const Check = withDefaults(CheckIcon);
export const CheckCircle = withDefaults(CheckCircleIcon);
export const CheckCircle2 = withDefaults(CheckCircleIcon);
export const ChevronDown = withDefaults(ChevronDownIcon);
export const ChevronLeft = withDefaults(ChevronLeftIcon);
export const ChevronRight = withDefaults(ChevronRightIcon);
export const ChevronsLeft = withDefaults(ChevronDoubleLeftIcon);
export const ChevronsRight = withDefaults(ChevronDoubleRightIcon);
export const ChevronUp = withDefaults(ChevronUpIcon);
export const Circle = createSimpleIcon(function CircleIcon(props, ref) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" ref={ref} {...props}>
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
});
export const Clock = withDefaults(ClockIcon);
export const Copy = withDefaults(DocumentDuplicateIcon);
export const Database = withDefaults(CircleStackIcon);
export const Download = withDefaults(ArrowDownTrayIcon);
export const ExternalLink = withDefaults(ArrowTopRightOnSquareIcon);
export const Eye = withDefaults(EyeIcon);
export const File = withDefaults(DocumentIcon);
export const FileArchive = withDefaults(ArchiveBoxIcon);
export const FileImage = withDefaults(PhotoIcon);
export const FileJson = withDefaults(CodeBracketSquareIcon);
export const FileText = withDefaults(DocumentTextIcon);
export const FolderOpen = withDefaults(RectangleStackIcon);
export const GitBranch = withDefaults(ShareIcon);
export const GitFork = withDefaults(ArrowsRightLeftIcon);
export const Globe = withDefaults(GlobeAltIcon);
export const GripVertical = createSimpleIcon(function GripVerticalIcon(props, ref) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" ref={ref} {...props}>
      <circle cx="7" cy="5" r="1.2" />
      <circle cx="13" cy="5" r="1.2" />
      <circle cx="7" cy="10" r="1.2" />
      <circle cx="13" cy="10" r="1.2" />
      <circle cx="7" cy="15" r="1.2" />
      <circle cx="13" cy="15" r="1.2" />
    </svg>
  );
});
export const Hammer = withDefaults(WrenchScrewdriverIcon);
export const HardDrive = withDefaults(ServerStackIcon);
export const History = withDefaults(ArrowPathIcon);
export const Image = withDefaults(PhotoIcon);
export const ImageIcon = Image;
export const Info = withDefaults(InformationCircleIcon);
export const Layers = withDefaults(RectangleStackIcon);
export const Link = withDefaults(LinkIcon);
export const ListChecks = withDefaults(ClipboardDocumentCheckIcon);
export const Loader2 = withDefaults(ArrowPathIcon);
export const Lock = withDefaults(LockClosedIcon);
export const Menu = withDefaults(Bars3Icon);
export const MessageSquare = withDefaults(ChatBubbleLeftEllipsisIcon);
export const Minus = withDefaults(MinusIcon);
export const Moon = withDefaults(MoonIcon);
export const Sun = withDefaults(SunIcon);
export const PanelLeft = withDefaults(ViewColumnsIcon);
export const Pencil = withDefaults(PencilIcon);
export const Pickaxe = withDefaults(WrenchScrewdriverIcon);
export const Play = withDefaults(PlayIcon);
export const Plug = withDefaults(CpuChipIcon);
export const Plus = withDefaults(PlusIcon);
export const RefreshCw = withDefaults(ArrowPathIcon);
export const Save = createSimpleIcon(function SaveIcon(props, ref) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" ref={ref} {...props}>
      <path d="M4 3.5A1.5 1.5 0 0 1 5.5 2h6.879a1.5 1.5 0 0 1 1.06.44l2.121 2.12A1.5 1.5 0 0 1 16 5.621V16.5A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5v-13Z" />
      <path fill="white" d="M7 3h5v3H7zM7 11h6v4H7z" />
    </svg>
  );
});
export const Search = withDefaults(MagnifyingGlassIcon);
export const Send = withDefaults(PaperAirplaneIcon);
export const Server = withDefaults(ServerIcon);
export const Settings = withDefaults(Cog6ToothIcon);
export const Settings2 = withDefaults(AdjustmentsHorizontalIcon);
export const Sparkles = withDefaults(SparklesIcon);
export const Square = createSimpleIcon(function SquareIcon(props, ref) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" ref={ref} {...props}>
      <rect x="4" y="4" width="12" height="12" rx="2" />
    </svg>
  );
});
export const Target = withDefaults(ViewfinderCircleIcon);
export const Terminal = withDefaults(CommandLineIcon);
export const ThumbsDown = withDefaults(HandThumbDownIcon);
export const ThumbsUp = withDefaults(HandThumbUpIcon);
export const Trash = withDefaults(TrashIcon);
export const Trash2 = withDefaults(TrashIcon);
export const Upload = withDefaults(ArrowUpTrayIcon);
export const User = withDefaults(UserIcon);
export const Users = withDefaults(UsersIcon);
export const UsersRound = withDefaults(UserGroupIcon);
export const Wifi = withDefaults(WifiIcon);
export const Wrench = withDefaults(WrenchIcon);
export const X = withDefaults(XMarkIcon);
export const XCircle = withDefaults(XCircleIcon);
export const XIcon = X;
export const GlobeIcon = withDefaults(LanguageIcon);
