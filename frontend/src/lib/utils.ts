import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function getLogColor(level: string): string {
  const colors: Record<string, string> = {
    ERROR: 'text-red-500',
    WARN: 'text-yellow-500',
    WARNING: 'text-yellow-500',
    INFO: 'text-blue-400',
    DEBUG: 'text-gray-400',
    FATAL: 'text-red-600',
  }
  return colors[level.toUpperCase()] || 'text-gray-300'
}
