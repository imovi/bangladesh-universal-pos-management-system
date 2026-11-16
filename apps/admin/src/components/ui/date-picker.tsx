"use client";

import React, { useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn, formatDate } from "@/lib/utils";

interface DatePickerProps {
  value?: string; // YYYY-MM-DD
  onChange?: (dateStr: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  className,
  disabled,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedDate = value ? parseISO(value) : undefined;
  const isDateValid = selectedDate && isValid(selectedDate);

  const handleSelect = (date: Date | undefined) => {
    if (date && isValid(date)) {
      const formattedIso = format(date, "yyyy-MM-dd");
      onChange?.(formattedIso);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel || "Choose date"}
          className={cn(
            "h-9 px-3 justify-start text-left font-normal text-xs md:text-sm flex items-center gap-2",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {isDateValid ? formatDate(selectedDate) : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={isDateValid ? selectedDate : undefined}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  );
}

interface DateRangePickerProps {
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  onChange?: (range: { startDate: string; endDate: string }) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  placeholder = "DD/MM/YYYY – DD/MM/YYYY",
  className,
  disabled,
  "aria-label": ariaLabel,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const parsedStart = startDate ? parseISO(startDate) : undefined;
  const parsedEnd = endDate ? parseISO(endDate) : undefined;

  const validStart = parsedStart && isValid(parsedStart) ? parsedStart : undefined;
  const validEnd = parsedEnd && isValid(parsedEnd) ? parsedEnd : undefined;

  const range: DateRange | undefined = validStart
    ? { from: validStart, to: validEnd || validStart }
    : undefined;

  const handleSelect = (selectedRange: DateRange | undefined) => {
    if (!selectedRange?.from) return;
    const startStr = format(selectedRange.from, "yyyy-MM-dd");
    const endStr = selectedRange.to ? format(selectedRange.to, "yyyy-MM-dd") : startStr;
    onChange?.({ startDate: startStr, endDate: endStr });
    if (selectedRange.to) {
      setOpen(false);
    }
  };

  const displayText =
    validStart && validEnd
      ? `${formatDate(validStart)} – ${formatDate(validEnd)}`
      : validStart
      ? formatDate(validStart)
      : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel || "Choose date range"}
          className={cn(
            "h-9 px-3 justify-start text-left font-normal text-xs md:text-sm flex items-center gap-2",
            (!startDate || !endDate) && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{displayText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={handleSelect}
          numberOfMonths={1}
        />
      </PopoverContent>
    </Popover>
  );
}
