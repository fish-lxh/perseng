#!/bin/sh

# Perseng Universal Launcher
# 目录无关的 Perseng 启动器
# 自动检测运行环境并选择合适的启动方式
# 兼容 bash 和 sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 获取脚本所在的绝对路径（即 Perseng 项目根目录）
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)"
PERSENG_ROOT="$(dirname "$SCRIPT_PATH")"

# 调试模式
if [ "${PERSENG_DEBUG}" = "true" ]; then
    echo -e "${CYAN}[DEBUG] Script path: $SCRIPT_PATH${NC}"
    echo -e "${CYAN}[DEBUG] Perseng root: $PERSENG_ROOT${NC}"
    echo -e "${CYAN}[DEBUG] Current directory: $(pwd)${NC}"
fi

# 检测是否为开发模式（在 Perseng 源码目录内运行）
is_dev_mode() {
    # 如果当前目录是 Perseng 项目目录或其子目录
    case "$(pwd)" in
        "$PERSENG_ROOT"*)
            return 0
            ;;
    esac

    # 如果环境变量明确指定了开发模式
    if [ "${PERSENG_DEV}" = "true" ] || [ "${PERSENG_ENV}" = "development" ]; then
        return 0
    fi
    return 1
}

# 检查是否安装了全局 promptx
has_global_promptx() {
    if command -v promptx >/dev/null 2>&1; then
        # 确保不是指向自己
        local global_path=$(which promptx)
        if [ "$global_path" != "$SCRIPT_PATH/perseng.sh" ]; then
            return 0
        fi
    fi
    return 1
}

# 设置开发环境变量
setup_dev_env() {
    export PERSENG_ENV=development
    export PERSENG_DEV_MODE=true
    export PERSENG_SOURCE_ROOT="$PERSENG_ROOT"
    export PERSENG_SYSTEM_ROLE_PATH="$PERSENG_ROOT/packages/resource/role"

    if [ "${PERSENG_DEBUG}" = "true" ]; then
        echo -e "${GREEN}✅ 开发环境变量已设置${NC}"
        echo "  PERSENG_ENV=$PERSENG_ENV"
        echo "  PERSENG_DEV_MODE=$PERSENG_DEV_MODE"
        echo "  PERSENG_SOURCE_ROOT=$PERSENG_SOURCE_ROOT"
    fi
}

# 主逻辑
main() {
    local use_dev=false
    local promptx_cmd=""

    # 判断使用哪种模式
    # 如果是 mcp-server 命令，始终使用开发模式
    if [ "$1" = "mcp-server" ] || is_dev_mode; then
        # 开发模式：使用 CLI 包
        use_dev=true
        promptx_cmd="node $PERSENG_ROOT/apps/cli/dist/promptx.js"

        # 设置开发环境变量
        setup_dev_env

        # 检查依赖
        if [ ! -d "$PERSENG_ROOT/node_modules" ]; then
            echo -e "${YELLOW}⚠️  开发模式：检测到依赖未安装${NC}"
            echo -e "${BLUE}正在安装依赖...${NC}"
            cd "$PERSENG_ROOT"
            if command -v pnpm >/dev/null 2>&1; then
                pnpm install
            else
                npm install
            fi
            echo -e "${GREEN}✅ 依赖安装完成${NC}"
            cd - > /dev/null
        fi

        if [ "${PERSENG_DEBUG}" = "true" ] || [ "$1" = "--version" ] || [ "$1" = "-v" ]; then
            echo -e "${BLUE}🔧 Perseng (开发模式)${NC}"
        fi
    elif has_global_promptx; then
        # 生产模式：使用全局安装的 promptx
        promptx_cmd="promptx"

        if [ "${PERSENG_DEBUG}" = "true" ]; then
            echo -e "${GREEN}📦 使用全局安装的 Perseng${NC}"
        fi
    else
        # 回退到源码模式
        echo -e "${YELLOW}⚠️  未找到全局 Perseng，使用源码模式${NC}"
        promptx_cmd="node $PERSENG_ROOT/apps/cli/dist/promptx.js"

        # 检查 Node.js
        if ! command -v node >/dev/null 2>&1; then
            echo -e "${RED}❌ 错误：未找到 Node.js${NC}"
            echo -e "${YELLOW}请先安装 Node.js: https://nodejs.org${NC}"
            exit 1
        fi

        # 检查依赖
        if [ ! -d "$PERSENG_ROOT/node_modules" ]; then
            echo -e "${YELLOW}正在安装依赖...${NC}"
            cd "$PERSENG_ROOT"
            if command -v pnpm >/dev/null 2>&1; then
                pnpm install
            else
                npm install
            fi
            cd - > /dev/null
        fi
    fi

    # 执行 Perseng 命令
    if [ "${PERSENG_DEBUG}" = "true" ]; then
        echo -e "${CYAN}[DEBUG] 执行命令: $promptx_cmd $@${NC}"
    fi

    # 使用 exec 替换当前进程，保持信号处理
    exec $promptx_cmd "$@"
}

# 执行主逻辑
main "$@"
