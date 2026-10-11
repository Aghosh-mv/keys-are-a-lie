#!/usr/bin/env bash
# Cuts the raw capture into the submission edit:
#   notice -> play -> blur -> play -> blur -> notice -> play -> blur -> play -> BLUR finish
# Every blur is a real gaussian blur (transparent-looking, never a black screen),
# each blur <= 3s, total blur <= 20s.
set -e
cd "$(dirname "$0")/.."
D=dist
W=960; H=456
mkdir -p $D/seg
rm -f $D/seg/*.mp4

# ---- timeline (seconds into raw.mp4) -------------------------------------
# notice(5) play(45) blur(3) play(45) blur(3) notice(5) play(45) blur(3) play(30) blur(3)
T="0:45 45:48 48:93 93:96 96:141 141:144 144:174 174:177 177:207 207:210"

cut_play() { # start dur
  ffmpeg -v error -y -ss "$1" -t "$2" -i $D/raw.mp4 -c:v libx264 -preset veryfast \
    -crf 20 -pix_fmt yuv420p -r 30 "$3"
}
cut_blur() { # start dur  -- real blur, kept slightly translucent, never black
  ffmpeg -v error -y -ss "$1" -t "$2" -i $D/raw.mp4 \
    -filter_complex "[0:v]gblur=sigma=22,eq=brightness=0.06:saturation=1.15[v]" \
    -map "[v]" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30 "$3"
}
notice() { # out
  ffmpeg -v error -y -loop 1 -i $D/notice.png -t 5 -r 30 \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p "$1"
}

# 1 notice
notice $D/seg/00.mp4
# 2 play 0-45
cut_play 0 45 $D/seg/01.mp4
# 3 blur 45-48
cut_blur 45 3 $D/seg/02.mp4
# 4 play 48-93
cut_play 48 45 $D/seg/03.mp4
# 5 blur 93-96
cut_blur 93 3 $D/seg/04.mp4
# 6 notice
notice $D/seg/05.mp4
# 7 play 96-141
cut_play 96 45 $D/seg/06.mp4
# 8 blur 141-144
cut_blur 141 3 $D/seg/07.mp4
# 9 play 144-174
cut_play 144 30 $D/seg/08.mp4
# 10 final FULL BLUR finish 174-177
cut_blur 174 3 $D/seg/09.mp4

printf "file '%s'\n" $PWD/dist/seg/*.mp4 > $D/seg/list.txt
ffmpeg -v error -y -f concat -safe 0 -i $D/seg/list.txt \
  -f lavfi -stream_loop -1 -i anullsrc=r=44100:cl=stereo \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 96k \
  -shortest -movflags +faststart $D/gameplay.mp4

rm -rf $D/seg
echo "built $D/gameplay.mp4"
ffprobe -v error -show_entries format=duration -of csv=p=0 $D/gameplay.mp4