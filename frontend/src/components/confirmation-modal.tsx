import { AlertTriangle, X } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isLoading?: boolean;
    variant?: 'danger' | 'warning' | 'info';
}

export default function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isLoading = false,
    variant = 'warning'
}: ConfirmationModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="w-full max-w-md bg-[#1e1e1e] border border-[#333] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[#333]">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "p-2 rounded-lg",
                            variant === 'danger' ? "bg-red-500/10" : "bg-yellow-500/10"
                        )}>
                            <AlertTriangle className={cn(
                                "w-5 h-5",
                                variant === 'danger' ? "text-red-500" : "text-yellow-500"
                            )} />
                        </div>
                        <h3 className="text-lg font-bold text-white">{title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-[#333] rounded-full transition-colors text-gray-500 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    <p className="text-gray-300 leading-relaxed">
                        {message}
                    </p>

                    <div className="mt-6 p-4 bg-blue-500/5 rounded-xl border border-blue-500/10">
                        <p className="text-xs text-blue-400 leading-relaxed">
                            <span className="font-bold uppercase tracking-wider text-[10px] block mb-1">Impact</span>
                            This will trigger a rolling restart of the ECS service. New containers will start before old ones are stopped, ensuring zero downtime.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3 p-4 bg-[#252525] border-t border-[#333]">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        className="flex-1 text-gray-400 hover:text-white hover:bg-[#333]"
                        disabled={isLoading}
                    >
                        {cancelText}
                    </Button>
                    <Button
                        onClick={onConfirm}
                        className={cn(
                            "flex-1 font-bold",
                            variant === 'danger' ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                        )}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Processing...</span>
                            </div>
                        ) : (
                            confirmText
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}
