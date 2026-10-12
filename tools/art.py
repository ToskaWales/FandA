import math,os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','assets','art'))
def rosette(n,a,b,copies,pts=520,rot0=0.0,phase=0.0):
    out=[]
    for c in range(copies):
        th=rot0+ (2*math.pi/copies)*c
        pl=[]
        for i in range(pts+1):
            t=2*math.pi*i/pts
            x=a*math.cos(t)+b*math.cos(n*t+phase)
            y=a*math.sin(t)-b*math.sin(n*t+phase)
            xr=x*math.cos(th)-y*math.sin(th); yr=x*math.sin(th)+y*math.cos(th)
            pl.append(f"{xr:.1f},{yr:.1f}")
        out.append('<polyline points="'+' '.join(pl)+'"/>')
    return out
def rings(rs): return [f'<circle r="{r}"/>' for r in rs]
def svg(name,els,size=1000):
    h=size/2
    s=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-h} {-h} {size} {size}" fill="none" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke">'+''.join(els)+'</svg>'
    open(name,'w').write(s); print(name,len(s)//1024,'KB')
# Hero: layered rosette + fine rings
svg('hero.svg', rings([480,470,330,326])+rosette(13,300,120,16,rot0=0.1)+rosette(26,215,48,10,rot0=0.0)+rosette(7,120,50,7,pts=300))
svg('a1.svg', rings([470,466])+rosette(9,330,120,14))
svg('a2.svg', rings([470,466,300])+rosette(14,320,100,12,rot0=.2))
svg('a3.svg', rings([470,466])+rosette(21,330,70,12)+rosette(5,150,70,6,pts=300))
svg('a4.svg', rings([470,466,420,380,340])+rosette(32,240,36,10)+rosette(11,120,40,8,pts=300))
svg('band.svg', rings([480,476])+rosette(17,330,95,18,rot0=.05)+rosette(34,200,30,10))
