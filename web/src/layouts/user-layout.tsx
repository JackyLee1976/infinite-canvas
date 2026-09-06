import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { OwWorkspaceBridge } from "@/components/layout/ow-workspace-bridge";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
            {/* OneWork 工作区桥：全局监听 workspace-switched 消息 + 左下角工作区角标（隔离专项 P0） */}
            <OwWorkspaceBridge />
        </div>
    );
}
