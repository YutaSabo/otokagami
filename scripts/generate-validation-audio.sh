#!/bin/sh
set -eu

# Generates development-validation reference audio from the three exact texts
# that already have manual-review evidence in supabase/seed.sql. These files are
# not production content and are not human audio reviewed or Azure validated.

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir="$project_root/apps/api/public/validation-audio/r-l"
work_dir=$(mktemp -d /tmp/otokagami-validation-audio.XXXXXX)

mkdir -p "$output_dir"

generate() {
  key=$1
  rate=$2
  text=$3
  source_file="$work_dir/$key.aiff"
  destination_file="$output_dir/$key.wav"
  say -v Samantha -r "$rate" -o "$source_file" "$text"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$source_file" "$destination_file"
}

generate light.standard 180 "light"
generate light.slow 110 "light"
generate right.standard 180 "right"
generate right.slow 110 "right"
generate read.standard 180 "I read it again."
generate read.slow 110 "I read it again."

echo "Generated validation-only WAV files in $output_dir"
echo "Intermediate AIFF files retained in $work_dir"
