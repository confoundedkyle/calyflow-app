"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabNav({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const isDocuments = pathname.startsWith(`${basePath}/documents`);
  const isSettings = pathname.startsWith(`${basePath}/settings`);

  const tabs = [
    {
      href: `${basePath}/agents`,
      label: "Agents",
      active: !isDocuments && !isSettings,
    },
    { href: `${basePath}/documents`, label: "Documents", active: isDocuments },
    { href: `${basePath}/settings`, label: "Settings", active: isSettings },
  ];

  return (
    <nav className="mb-4 flex gap-1 border-b border-navy-800/10">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={[
            "whitespace-nowrap px-4 py-2.5 text-[15px] font-medium transition",
            tab.active
              ? "border-b-2 border-mint-700 text-mint-700"
              : "text-navy-800/50 hover:text-navy-900",
          ].join(" ")}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
