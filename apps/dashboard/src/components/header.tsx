import { Skeleton } from "@midday/ui/skeleton";
import { Suspense } from "react";
import { ConnectionStatus } from "@/components/connection-status";
import { NotificationCenter } from "@/components/notification-center";
import { OpenSearchButton } from "@/components/search/open-search-button";
import { UserMenu } from "@/components/user-menu";
import { MobileMenu } from "./mobile-menu";

function UserMenuSkeleton() {
  return <Skeleton className="w-8 h-8 rounded-full" />;
}

export function Header() {
  return (
    <header
      className="sticky md:m-0 z-40 flex h-[70px] items-center justify-between border-b border-border/80 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-8 desktop:rounded-t-xl transition-transform"
      style={{
        transform: "translateY(calc(var(--header-offset, 0px) * -1))",
        transitionDuration: "var(--header-transition, 200ms)",
        willChange: "transform",
      }}
    >
      <MobileMenu />

      <OpenSearchButton />

      <div className="flex space-x-2 ml-auto">
        <ConnectionStatus />
        <NotificationCenter />
        <Suspense fallback={<UserMenuSkeleton />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
