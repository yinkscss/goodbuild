#!/bin/sh
# usage: encode.sh FRAMES_DIR SUBFRAMES OUT.mp4 [AUDIO.wav] [extra ffmpeg vf, e.g. crop]
# Blends SUB subframes per output frame with tmix, keeps every SUB-th, tags BT.709 limited range.
D=$1; S=$2; OUT=$3; A=$4; EXTRA=$5
VF="tmix=frames=$S,select='eq(mod(n\,$S)\,$((S-1)))',setpts=N/60/TB"
[ -n "$EXTRA" ] && VF="$VF,$EXTRA"
VF="$VF,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
if [ -n "$A" ]; then AIN="-i $A -c:a aac -b:a 192k -shortest"; fi
ffmpeg -y -loglevel error -framerate $((60*S)) -pattern_type glob -i "$D/f*.png" $AIN -vf "$VF" -r 60 -c:v libx264 -crf 14 -preset slow -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart "$OUT"
