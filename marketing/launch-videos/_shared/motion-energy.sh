#!/bin/sh
# usage: motion-energy.sh video.mp4 beats_per_second_frames(30) -> per-beat mean frame-difference (0 = frozen)
ffmpeg -loglevel error -i "$1" -vf "scale=480:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - | grep YAVG | sed 's/.*=//' | python3 -c "
import sys
v=[float(x) for x in sys.stdin]; n=int(sys.argv[1])
for b in range(len(v)//n):
    c=v[b*n:(b+1)*n]; print('beat %2d  mean %.3f  max %.3f'%(b,sum(c)/len(c),max(c)))
" $2
