import { useState, type CSSProperties } from "react";
import { Alert, Button, Modal, Tag, Timeline } from "antd";
import { useVersionCheck } from "@/hooks/use-version-check";
import { APP_VERSION } from "@/constant/env";

function getTagColor(type: string) {
    if (type === "新增") return "green";
    if (type === "修复") return "red";
    if (type === "调整") return "blue";
    if (type === "文档") return "purple";
    return "default";
}

function getReleaseTitle(version: string) {
    return version === "Unreleased" ? "未发布" : version;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

const CANVAS_UPDATE_COMMAND =
    "cd /d L:/00-projects/infinite-canvas && git pull origin main && cd web && npm install";

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { open, setOpen, openReleaseModal, latestVersion, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck();
    const [showUpdateGuide, setShowUpdateGuide] = useState(false);
    const [copied, setCopied] = useState(false);

    return (
        <>
            <button
                type="button"
                className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                style={style}
                onClick={openReleaseModal}
                title="查看版本更新"
            >
                <span className="relative inline-flex">
                    {APP_VERSION}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                </span>
            </button>
            <Modal title="版本更新" open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="mb-5 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="text-xs text-stone-500 dark:text-stone-400">当前版本</div>
                        <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{APP_VERSION}</div>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-stone-500 dark:text-stone-400">最新版本</div>
                            <button
                                type="button"
                                className="cursor-pointer bg-transparent p-0 text-[11px] font-normal text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline dark:text-stone-500 dark:hover:text-stone-300"
                                onClick={() => void checkLatestRelease(true)}
                            >
                                {checking ? "检查中..." : "检查更新"}
                            </button>
                        </div>
                        <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
                    </div>
                </div>
                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                    <div>
                        <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">更新到最新版</div>
                        <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">当前 {APP_VERSION} → 最新 {latestVersion}</div>
                    </div>
                    <Button type="primary" size="small" onClick={() => setShowUpdateGuide((v) => !v)}>
                        {showUpdateGuide ? "收起指引" : "更新"}
                    </Button>
                </div>
                {showUpdateGuide ? (
                    <div className="mb-3">
                        <Alert
                            type="info"
                            showIcon={false}
                            message={
                                <div className="text-xs leading-5">
                                    在终端执行以下命令完成更新，然后刷新/重开创作画布面板：
                                    <code className="mx-1 rounded bg-stone-200/70 px-1.5 py-0.5 font-mono text-[11px] text-stone-800 dark:bg-stone-800 dark:text-stone-200">
                                        {CANVAS_UPDATE_COMMAND}
                                    </code>
                                </div>
                            }
                            action={
                                <Button
                                    size="small"
                                    onClick={() => {
                                        void navigator.clipboard.writeText(CANVAS_UPDATE_COMMAND).then(() => {
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 2000);
                                        });
                                    }}
                                >
                                    {copied ? "已复制" : "复制命令"}
                                </Button>
                            }
                        />
                    </div>
                ) : null}
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                    <Timeline
                        items={releases.map((release) => ({
                            content: (
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{getReleaseTitle(release.version)}</span>
                                        <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {release.version === latestVersion ? <Tag color="green">最新</Tag> : null}
                                            {release.version === APP_VERSION ? <Tag>当前</Tag> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                    {item.type}
                                                </Tag>
                                                <span className="min-w-0 flex-1">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ),
                        }))}
                    />
                </div>
            </Modal>
        </>
    );
}
