"use client";

import React from "react";

export default function PosRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased flex flex-col select-none overflow-hidden h-screen w-screen">
      {children}
    </div>
  );
}
