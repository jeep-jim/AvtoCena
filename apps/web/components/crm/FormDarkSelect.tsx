"use client";
import { useState } from "react";
import { DarkSelect, type DarkSelectOption } from "./DarkSelect";
export function FormDarkSelect({ name, label, value, options }: { name: string; label: string; value: string; options: DarkSelectOption[] }) { const [current,setCurrent]=useState(value); return <DarkSelect name={name} label={label} value={current} options={options} onChange={setCurrent}/>; }
