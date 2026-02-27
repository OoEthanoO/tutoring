"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function MigrationBanner() {
    const searchParams = useSearchParams();
    const [isVisible, setIsVisible] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);

    useEffect(() => {
        // Check if the user was redirected and verify their dismissal preference
        const redirected = searchParams.get("redirected") === "true";
        const dismissed = localStorage.getItem("yanlearn_migration_banner_dismissed") === "true";

        if (redirected) {
            setIsDismissed(dismissed);
            // Give a slight delay before showing to ensure layout doesn't overly jump or look jarring on initial pain
            setIsVisible(!dismissed);
        }
    }, [searchParams]);

    const handleDismiss = () => {
        localStorage.setItem("yanlearn_migration_banner_dismissed", "true");
        setIsDismissed(true);
        setIsVisible(false);
    };

    if (!isVisible || isDismissed) {
        return null;
    }

    return (
        <div className="bg-blue-600 px-4 py-3 text-white sm:flex sm:items-center sm:justify-center sm:px-6 lg:px-8">
            <div className="flex w-full max-w-7xl items-center justify-between gap-4">
                <p className="text-sm font-medium">
                    <strong>Notice:</strong> We&apos;ve moved! Ethan&apos;s Coding Class is now <strong>YanLearn</strong>.
                    Please update your bookmarks to <a href="https://learn.ethanyanxu.com" className="underline font-semibold hover:text-blue-100 transition-colors">learn.ethanyanxu.com</a>.
                </p>
                <button
                    type="button"
                    className="-m-1.5 flex flex-none items-center justify-center p-1.5 rounded-full hover:bg-blue-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={handleDismiss}
                    aria-label="Dismiss"
                >
                    <svg
                        className="h-5 w-5 text-white"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
