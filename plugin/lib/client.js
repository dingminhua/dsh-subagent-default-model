// dsh-subagent-default-model client — settings panel for the subagent default model.
// Extracted from @aaravarr/dsh-subagent-max (licensed MIT) and adapted as a
// standalone client entry for this plugin.

window.__ModuleLoader__.load({
  id: "dsh-subagent-default-model",
  factory: function (require) {
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Toast = primitives.Toast;
    // ── 图标族适配（DSH 0.1.7 起重命名）──────────────────────────────────
    // 旧命名以尺寸为后缀（IconChevronDownOutline14），新命名改为粗细语义后缀
    // （IconChevronDownOutlineRegular / …Medium）。按名探测取第一个可用的，
    // 全缺失时由使用点渲染自绘字形——把 undefined 直接交给 React.createElement
    // 会在渲染期抛错。
    var IconChevronDown = primitives.IconChevronDownOutlineRegular
      || primitives.IconChevronDownOutlineMedium
      || primitives.IconChevronDownOutline14
      || null;

    // ── GitHub 页面（「鼓励一下」链接目标） ──────────────────────────────
    var DSM_GITHUB_URL = "https://github.com/dingminhua/dsh-subagent-default-model";

    // ── plugin icon (LD brand logo, 64px) ────────────────────────────────
    var DSM_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAXGUlEQVR4nH1bC7BdVXn+1tr7nHPvzb3JvUloSAQp0JHWoAMttKOCFrWU8irQSbCTQYG21IahnTJUUTsM0FJhZCzCSIcKImOpDkhrhQ5YC7ROB3lUBU3EyCuBFBIIedzcx3ntvTr/a621TwIns3PO3mfvddf/+v7v/9c6DvYKoYBz1cZNYfJpVBcNBm7dcIhj3TBM15VzqAE6XAWEGggVADroOl0byDW+PtRr9E732rl9r2PxOMNsrCogVE7PA0Kge4Lcz5/TGI6v00UaK+h98u4QUA9quIDg4Pe2i2LTsknc++mzZu9cv37VHNaFAveSJICj/9aFUNzrXHXSTwdnznl/Y+X9MaEP1D0A/ToKaUdDASoAK0YVYcLad/G88S6C1aQcOkI2Nj9HylBFBRMYqPUeFp6EDXQfKcIUoud6LQQP59rwrsBEOdhy9KGDK/7j9mUPmBKcCf++Z4YbF6eKLw+6QFioKl/DoYILlXMsHE2KPCCzwlsqoNb3oUw4Kq+2a0k4G4MtXOX3J4HNyulzUkC0eqYI8ZAaQZQSAh9080Qx1m7jHStnL/3B3ctvXbcuFOwBH/p5OG12DA/29leV6wcHeI8hadE1rBldl/6ACs7WMEuz0PIcKawe0Gdzeyf36eTzcOHxVAEpTEQB0QtY0PRZPMYsX+t3tSqBxkteYeHh6qqu6yIsmVhaHHtE7/fu/8fJhzzF/OywunXQR+DJOO9pkLp2NJ64pIXhaOxb/IfmJM29PemSJ+NSzJP1s2dhwmucJ6uaoIYFzVjnkFDhLRTkb2XC03gQTKDrZNjSV1icXwzPv9y99Z5Hw6R/psQnqoniyLBQ1d65IoGiDqZuHwWwzyFzx8xl5RDBZR4uCZc9E8fS+8TdSfHZ2KxAel6VwEIYZiflxC9NKToeKcKrAcjV2d2DK3xYqOcXJ478ytf2fcL3htWGegAaSZGeBnKixWgVPXRiZpEomLq4Kcri2RCc7zN3NWuq5XlOJLwqjq9liqlHlEfzSveIdVk0Fjh5kVjdjKLneniCtcEg7N492FBWAWvrHpwLzgmYUfySi+VorcJFBE6I7jIAjFnC3DybePKE5ClxLLsPI0q3kNAsYJ4g1wjkzDuju4nQJrx6RxRe/7YHfFX3MOyHtaUHloaKcqa4rcQTDWxubHnZ0lESNoaGXad7+RmLc7GMxbS4s8Y82S3mdhMshR+Po4pk181jkx22afHc8hL3plNTjOGDjEfu7pxfWkpcyA02Ofo6xpylPsMCi3eNTROShVawM0H4+4bXaGqzcTKQzc8j6VGPkb9tFtU56bwlBdK9ZMQMKNgolMtVKepFcq6hBMAzQJAQ6srG9iwNJRfN0LtWd64z1qZjRPDieBYQkyNTqFpCsoYoKQFoFt8xhA5icZ2fXWOwY4GScsT95Tv7XoSnd0ehgLJBSPSdkdhYWbSeAk2eCSzuScDs/qQo9dpRZarVWWm5ZRuxn8YRRabYtiwhn5PVRXD9js8FzM2rowKII7MnOJSR2GSZJMVUckfzjIjKMe2p5fOsENGfPESR38AwB8AsZTUBUV025TwWVEAsubSl6gYA8rU6eUMmvE2ErjMrQEDZQGkewGI6TcqPAhlT1hHBBV0xZC/R3B09JFmdXDESrIz5GRPMlWQA6kNAoVbjf7FAyq1vsW8xrt+rImI4aEiwIuqAMjI9y/8Z5RSAS+f04P4uTcihozDLaO6kZup2gSWFIXjm3plb75sHxkugMKzAgWmQcYmsTvqrgPkuMOgHFAhY0gnolDJfOgTM0t/xMcYTJeZz9QZRgHiUd5AQIHe2fNqIY3o4xiEw3wc++A6HvzweWNbWtKmsrF853PFEwDd/LEqoVOiYQQLQ7QGXn+Zw3okOhc9i1tw8umpS7mBQ4PW9Ab/YVuHxTTV+8EyF7TsqTHQCxtsBlVWSUVBViGYHcnMDQvaUyAv03wmPDcP8ECiy2lwOKl4CFz2+AoYDx1b73rkOayaVfUXziRMu9oGTbg54cz9pNlV9FEJzi8CJv+zwwOWWoZvZfXSst3rteDPgXx4e4LZv9fDS9grLlzotkclDakmXJCCFTswAdC5eZQqphwErZgr40QInAh4XHMbsHGt6ugSmWuLZwyqwlclFhwqOrSJgZky+izydc7bj+1ZPy7P9AT2nz/MR+PuK/g6/50fg8QdDGffQFQ4b13fwyFcmccl5HczOUgVYoXTcAGEBSWBzdRY4hoLUBvGeQGFgrM84gMWglq/mwszXqcSlAahgdi57l8/Mr9gaxiqbnZwheZMU23Lw88zN0zWff5ZzCpeyAApqTNWkjBorljnceMUEbvnMEqK0qIc1A6UAnYQS5/6Md4jTNxlhGUkKRYYBHmHCiEewJxQjzmmenFdphiXsZ0aKstogvmwkEiqwYml6MmS6kQkQKcUlICsIY6hyDAEbzupgZgr448/OouyI5Y3t8YgGfq5OIaHfeiZDWXclFizWw1OmF0lRQ4A8UWevnPTEsTNFjoQ7fV0UDq3SoSyBVgmU/FmOVsuz9VmfrCUBMPIMut4f1Dj9tzv4wqcmORzIvW1qwgOcYIC5vB0gzAClQW1EGuJXkgql2MlyuTHFhg4OAlrm8vRxtHrMFUhRV4trv/hawK3fqbF/QSwoYwSUPuCwlcDJ7y3wgeMKFHAYDgN7gOmwLBwGgxobzhnH/z7Txz9/exErpz2HK1teUZ+tTSGXZYZCFGAc3eqBZsESmZs1L0e92HK5TikSKA2N2CMY8QATfuvOgLOvqrBlW0CnyOioeWVF1/v4rXd7/M2fjeGEtQWGFO+FpkzFFPKOv/7zKXz/sR5m99foUJ2rRRNhhwCfAqBOxQkbVObHKSv14UZb2KnFdBAl5CdxvMwDcnotrTsW/vW9wPnXVdi2M+DwQ4DVK4CZSWDFVDp+aRkwNR7wxE8GOOuyWdz3vT7K0jMGyN8ToKTzFTMel2yYwPxcAJe56voR/eO7tOscY0Ls2GSFkJW+Nue8QTn6agJD6gta5mhwf7mHhCdesOGGCpu3AmMthzv+qsTHf6fArj0SP5YGKXNQZpleArRcjU9ePYdHnxgwPrAStK1EXkBhvO7scRx+aIleL2SWTzFP1qdQYkCs6dx66COob/28mB61GjzACwhmc9Q2rxnt/9GfUGwY1g4XfbHG488GjLWAmzYWOOU4zwAoKG6KteYG8YSAdunQKQM+dcMc9uwLbHnRv9Baumf5dIGPnNTB4jx5gQjNgisNLuH0Gr07ygKpjpdKsFnWGiuMXtLwfaPDpoRk/dFqjcYht6Q7P3lzhQefqvn87y4usOEjkgpjYlHhyT2psjMLErOcHANe3DbAXfd1xfUZVzRH6qMf/VA7E15JkfECdX9TiB+11ughDcisQGr4+wEfDqzrtegRxAau+aca3/gvEejK8z0uOcNhsUfWtAJGviOhrWKLXRwujgImx4Fvf3cR3V7gLGBRyDnfBbxnbQurVlImqJlEmdtLSpS/I9dACpD0l+I+sTjLCNbLe3sekHlEJry5/tJxh/98usZtDwo1vfTsAp/+mMeA0hrnPssalgl0PtoEEUYn18fbDltfHmLzlgEcs0MtiZ0oY+UKjyPWlBj0lRVGy3s+J2VQreKZIGUWq7MFDMEBaW01yMyoC7iRwmikG0zaZo5BcTwE9s0FXPS7Hp+/2DO356rQquKsvy9NDWV2yuXlM4Eb0O8FbN4ieTnCheIAKWLNao9qKPm/gJdD6bfhQkHlMLE9QmouF7Mlq1geM/hpO2xU/oNciT2K2B0Wik1/cHYu4Jz3O9y80bNXCOAJfnCzRAeguUhxbF0e7eLwMyIUKeW1HRkoWS9QXzPTnmWQvoOkQMED5Q8UDnDUE0ytLVv6jtbTyae6IP8T2qczNhKbAymLWP4nwXp94IhVDv9wWcGWoBRHHD/Fr8NPn6/Q8lpFpqCKwEgCGLsjF+4umOs3nZJeS8Y8ilrSHV0kazPqq6J5BRQylsgR4z2rALXhmWWkt8CAZvES49/aYDTZXsDxRzksnaDcTqAnz5DLtkqPux8c4LuPDTjfE9rnq0ziFUpotJfH4WFdjthUSbOjMdjFSXCtWg0EyyC9DU+fWcNq6UaDMq7tExJn6fFt3J+vKmPkZog9p4wqhoc6Dwvf8vjOfw9w+RcXucNj7e+0kpPa4wZmHDg1sHK5FAVCBXRgndb8XB2boj4TmBkgW9+AsLIOr/X6m/TX1uxjiyz3AOvjNQODMcVqb1GKrtrQ83qRQoCEf+SpITbeQJsSrLcnbhOR2zVZnBU0pXc46ghRAI+phMzGf3NnjRYBLOEPK8DzOxMheqcqFF5DIF+dyRZIYkhEgpJiNmn7wGIokhlLXWzNlEeHKvyTm4f4o+sWsdgNWHuUx2RHlG2KYDfniSaGyIUMMb4Zz/k+F5pGpyKp263x6v9VaBOztNyv40RmqGsG3o30+SMQZvXBAQsdb/UaJVTRdaVHZ2sPY22HzS9WuPDaLnbuqnHWySUe+vIU/uCjbcxRIUPpylKfeQMjuLTHF+drHH9sC2tWlxxGRKJiFADY/nKFXTsqjLUpE2jsx3Qq6C8A6CQEuP2V1wCNNfpmamvG/wg6amzLOmESPh+D0P7FVwMuuHoRW7dXOP19JW79zDjaLWBqQsLGipXo9jpZa2tTuG742EQmtKZSpcU/+VEf3fmANhVDbHnJGpEa8zUnxVK+o8N4fFx/H2F/MSXl3VvrBzhqUUmIJHdNedyAcfvrARdc08WzL9U4+bgSt181jjEFP1tljiVsrOHFAzothz27a5xx6jhOfn8HVUVU12YkvUR6/c/DPXQKEi4VPkyIuDrMiqNA3pbz/tGV29j3N68QetLweWuKKEOjdjMpsMX8Sb6nt2VLgCd/VuHMK4Z44ZUK7z26wJ1Xj2N6ynGKHOvYjhR6XumrKpFkbBfAnjcrrD2mhc9dORXpb5wJhULh8dzPB9j0wwEmlxDZMM9JyC9VoGQmz7wgU0Bc089dfqRCPKApqqsutCRGrarTf8PhjT0Bu2cDdu8L2LOvxu69AbP7A3a8UeEXWyu86zCPr187jjWHNFtclvqoFUZkiRRKf6/fDdj1eoXf/PUObrtlBstnpIVH1aB5IydBB3zr6wvodym/Sy9AKG8qi1NPgOixk7XBfJ0ub2o2lJBVdY2YsK6MFiWfO9/jnSuBHz1HHuGFSmuKC5XH6uUOHz+jhdUrndQChSiBXtTEoLRHQFj1a47bibbDrxxR4twzx7Bh/QTKlvCHKLzyf+oSbX66j0f/vYtlU1K/MAFSdyceEIVXAxdxeVy5fwPtRxHd9vw0GqBqIn4zWhpw4akeF5769gmDeADFr1mOXq/urHkN8Nyzx3DGKR20yoBDVhQ4+siSFUVWr014fZCUTue9bsCXrtsfOQIxWxNamiAKiOwZojxPHmBr75a/Y2hpP988pMEHYsfT1u0TEaFTyvMCS9m9htTWpIwlMMWuw8JizV3do99Z4PNXTnHLK9UXQemz4/rBhmW84naYw99fuw/PbR5g5XTBniwIT9bWuHcS+8YraAAfGyIZBlgGyHd45fv4UsTZW+rGmB7KghoVQkqK/J1XeEiIlLRJWRQ+DzzSx8+2DHHqB9osfK9Xs9DkKZRdpAucApDcXsb2uOX6WTz0r4tYQcIPc0HT59QBSpmgsBCILa98BSfb0jKa7jMAOEhTJOmGU2C85BCoINEvyT9IwHbL49WdFW68bZ6Xu9afPcZ3m+KUPFiASQiQkkuP/ftr3PS3s3j4/i73Aql+sc4vC6+rQIL2Qs+NY6QQqG0zZEZYLC2mYowfokVN1n6dGg/NV8YPzF1iBORlFK36BLS956XuP/3sPjy7ZYDL/2QJjv3VEr2+FDK8yKrZIa0byvS//0gPt39pDttfqHiVF4NEm2PDU0tgvpZ7AdMXMUZpW1Kb+4GaqY8+twpgx96A+x4PuPjDsmB54GukX3DQl1yfXwDuf7SHm766gJdfGeIPf38c11wxxd91aO/BQV673qjw1BMDPPhvi3j6yT7GSoeZZbKIa2UyNb3yJqitBebub6tPnosj22010rsf3exEgDNRAld9o8aPX3B412rdB2xgl1Hf0CiEMseoA3r9gG3bK/xw0wAvbB1iqkMkyeOw1QW+9s0FDAeCFeIwAYNewK5dNV7ZWmHb80O8uaNmUrR0Uqo6WgITmptITlRAg1LnZMiIEODec8MwkDV4707+A4isCHJD2cNr3GDfHLi/Z3v4448Xsj38EiepEOLqTru8RaDdHeDtLrZldn6/LnHbhLlNpwQmAB3vMNFxGOPtNZrmaqvzpbYXzm/ARyWvl4YIdYbU/Rn4CFMqYGq5ly0yVqUdUMnZ6q4Bl94zM2E9xGztTxc045aavK1Of1wxxQWiqDULYJuj6G/QEje7byAl6IT1YAF0H7HsKpUmjVV4eakcra6rwlIP6DJYtkbA6Ri8P0CB1jYv5u2lvBoULsfnnJpG9vCyIEqWZHeJrjJn48adGrzzSyZgGxek2ySeZqFjz3FjNd/vo0JKw8QEVgVqt0iKH1sDlBTKy+r6TLBx6nwFuPGefpMTc79Z3RRkPXw+H21njVSPcQ9fanXbWLymb/1/29RgkKmNTRuLBVXrxx0m+lkENmVY7S/zEWtrb9BWiRxlgZGCJ+a9PLHlfEDBTP2hsTFRdpVJNWdPx21qWVPDWtP5ik+j4Zn176wFzoWN9fcyoDNhI+dXppkA0XoCTQLEPCAIdhxk5Tur+nWPsChKYzxH97h/37aqm+z2Sw7ZvGRa5x5c3IuUlBBbVBYWBlymuEx4Gyuv74X4pDTXYILWD8ja4zRKYVR49Fcdxg3invt8yUsVJCRPHshrBWNZ+R49UYLt5tYfRcR6Xy0c3Ta5dJ6/Zd/vCNjlxCcueCa2l1pgGQDGzpIVSEPMyq6w5q+wzOoNUIzu0uz0SFhkHlHTiq4InO4zr9ENSjHO841N2e5ui3PrBTZQPFlagC0Jb54Vd4pZqNiOttgPoI4AZn1ZYLPzLoQatS2CNmod3T3W7Asc+Puc5D1JKRbpRJnFYgZAI9iQub7EvY9gxc9yW1vW+HgME3KkwSkNDs0EVnXqWqARIG3X1y3XDq0xbPbTS4q7vVcCN7qwGWM73/HV3P0t7iwImoOhlMZpe0rc8q7tblaE9vxzJaTCJa3nC/iZp6QFTgNGi/0mC9TvOTukUNLUG8Y6hZte7e/2l52Iu8ar6qXalR6hrhq5P0+LI7/DaYBgrHnMve1HEhYu6RkWgq2bvKDJ3cVGOfhZLOdYkaq8xPIYX2zVV72uyPBEN01XnTDuy2WLL33w+rG7/PpT3NyvrQ4bx9tww8qT1ejHNHFPQEJ6Ke0E1LJd2FmhR90g04xpP+tfKCjmYKaWIU/ImhcpTpXi2q7UfLeH9fXVqSVsTNiMD+Rh4uraDT2mlpXu8BNaG1etcnN+3T2huPcvWg8dubS6dHJJUfD6bFVXrq5rrw3+tCaXOuGmBENzAzHpu0tvL63uNj8bykdeoCkt8QHL+SqAkRxz60wJcQ9BFh6p7CX8CYEQLtShKocTfmbpRLHs3d1LT7u+9dA99tNZ+yHxBTcNztz0mr9x74I/hnZXhD7F/PCAn6bJz+U0vrPr7K5VJUJZf5/v040NDcG02LGGJVmfOsuxdifg03U9vUZHrPz0fl7p5caGjNkiEmTFUXBooUDbjWGs5TE+Pdyy6vjqijO+MPYACb+efjwdiYsqIewMk+d8tbro1b1uXXehPrYahmn+hZmGgtefqsalNFvU1BpAhM8QXhUlCmgCmihAUnBUQixk6J2eSYqwvM9Iz5sfrApM7LDF7W651oILbef3Tky0Nk2vcfeed0dxp3Nu7h6EYr2sgOL/Aa5OuMdnE5sWAAAAAElFTkSuQmCC";
    var SETTINGS_CSS = ".dsm-model-settings{display:flex;flex-direction:column;gap:14px;margin:0;padding:0}.dsm-model-settings-list{display:flex;flex-direction:column;gap:10px}.dsm-model-settings-route{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end;padding:10px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#202126)}.dsm-model-settings-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-model-settings-select{width:100%;max-width:220px;height:32px;padding:0 28px 0 10px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#232529);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;line-height:1.5}.dsm-model-settings-select:focus{outline:2px solid var(--dsw-alias-state-business-primary,#5686fe);outline-offset:1px}.dsm-model-settings-select:disabled{color:var(--dsw-alias-label-tertiary,#999);cursor:default}.dsm-model-settings-remove{height:32px;min-width:32px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#b8b8b8);cursor:pointer;font-size:16px;line-height:1}.dsm-model-settings-remove:hover{color:var(--dsw-alias-state-error-primary,#ef4444);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(242,90,90,.15))}.dsm-model-settings-options{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dsm-model-settings-strategy{display:flex;align-items:center;gap:8px;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-model-settings-strategy .dsm-model-settings-select{max-width:150px}.dsm-model-settings-failover{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8);cursor:pointer}.dsm-model-settings-failover input[type=checkbox]{cursor:pointer}.dsm-failover-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}.dsm-model-settings-footer{border-top:1px solid var(--dsw-alias-border-l2,#36373b);display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px}.dsm-model-settings-footer-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}.dsm-model-settings-footer-status{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#b8b8b8);font-size:12px;line-height:1.5}.dsm-model-settings-footer-error{flex:1;min-width:0;color:var(--dsw-alias-label-error,#ef4444);font-size:12px;line-height:1.5}.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}.dsm-btn:disabled{opacity:.4;cursor:default}.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}.dsm-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dsm-btn-primary:hover:not(:disabled){opacity:.9}.dsm-model-settings-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}.dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;display:inline-flex;transition:transform .16s}.dsm-plugin-card-chevron-open{transform:rotate(180deg)}.dsm-plugin-card-caret{color:inherit;font-size:12px;line-height:1;display:inline-flex}.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}.dsm-plugin-card-body .dsm-model-settings{margin:0;padding:12px 0 0;background:transparent;border:0;border-radius:0}.dsm-plugin-card-body .dsm-model-settings-head{display:none}.dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}.dsm-model-settings-cheer{display:inline-flex;align-items:center;gap:4px;flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5;transition:color .16s}.dsm-model-settings-cheer-star{font-size:12px;line-height:1;display:inline-flex}.dsm-model-settings-cheer:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}.dsm-model-settings-cheer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}.dsm-model-settings-warn{grid-column:1/-1;color:var(--dsw-alias-label-error,#ef4444);font-size:12px;line-height:18px}.dsm-model-settings-warn-list{display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-error,#ef4444);font-size:12px;line-height:18px}.dsm-notice-row{display:flex;flex-direction:column;gap:4px;margin:6px 0;font-size:12px}.dsm-notice-toggle{appearance:none;font:inherit;cursor:pointer;background:transparent;border:0;padding:2px 0;display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary,#9a9a9a);text-align:left;min-width:0}.dsm-notice-toggle:hover{color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-notice-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px;border-radius:3px}.dsm-notice-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-caption,#777)}.dsm-notice-label{flex:none;font-weight:500}.dsm-notice-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-notice-summary:before{content:'·';margin-right:6px;color:var(--dsw-alias-label-caption,#777)}.dsm-notice-body{margin:0;padding:8px 10px;border-left:2px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-1,#1b1b1d);color:var(--dsw-alias-label-secondary,#b8b8b8);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}";

    if (typeof document !== "undefined") {
      var cssId = "dsh-subagent-default-model/client.css";
      if (!document.querySelector("style[data-plugin-css='" + cssId + "']")) {
        var styleTag = document.createElement("style");
        styleTag.dataset.plugin = "dsh-subagent-default-model";
        styleTag.dataset.pluginCss = cssId;
        styleTag.textContent = SETTINGS_CSS;
        document.head.appendChild(styleTag);
      }
    }

    // ── locale ───────────────────────────────────────────────────────────
    var SUBAGENT_ROW_LOCALE = "settings.subagentModel";

    // ── 对话流注入行的自有节点 kind（2026-09-25）─────────────────────────
    //
    // 宿主 0.1.7 起，插件注入消息在**对话流不可见**：`dsh-client-ui-chat` 的分类
    // 逻辑是 `if (event.data.source.kind !== "user") → kind: "context"`（与 form
    // 无关），而可见性规则 `isVisibleChatNode()` 硬排除 `node.kind !== "context"`
    // （注释明写「Exclude system prompts, ordinary Context, and permission
    // commands from visible Chat rows」）。故本插件的注入只进轨迹。
    //
    // 绕开方式是注册**自有节点 kind**：该可见性黑名单只列 system-prompt /
    // context / permission 三项，自定义 kind 默认可见；渲染器经
    // `conversation.chat.node` 槽位按 `entryKey = node.kind` 运行时分派。
    //
    // 注意：`source.kind`（消息来源标识，仍是 "plugin:dsh-subagent-default-model"）
    // 与这里的**节点 kind** 是两件事，不要混改。trajectory 侧不受此影响
    // （isVisibleChatNode 只在 ui-chat），故 trajectory definition 保持原样。
    var CHAT_MODEL_NODE_KIND = "chat-subagent-model-notice";
    var SUBAGENT_ROW_ZH = {
      "row.title": "子代理默认模型（dsh-subagent-default-model）",
      "row.desc": "为 subagent / subagent_fork 选择一个或多个默认路由；清空后子代理继承父会话路由。",
      "row.provider": "Provider",
      "row.model": "Model",
      "row.effort": "推理强度",
      "row.add": "添加模型",
      "row.remove": "移除模型",
      "row.strategy": "分配策略",
      "row.roundRobin": "轮换",
      "row.random": "随机",
      "row.inherit": "（继承父会话路由）",
      "row.empty": "尚未指定默认模型，子代理将继承父会话路由。",
      "row.effortDefault": "Default",
      "row.discard": "放弃修改",
      "row.expand": "展开",
      "row.collapse": "收起",
      "row.cheer": "鼓励一下",
      "row.save": "保存",
      "row.saving": "保存中…",
      "row.saved": "已保存",
      "row.incomplete": "请为每个模型路由选择 Provider 和 Model。",
      "row.effortNoDeclaration": "该模型当前未声明任何推理强度；子代理会因 effort 不被支持而一个请求都发不出（清空此项或改选模型）。",
      "row.effortNotDeclared": "该模型当前未声明「{effort}」推理强度；子代理会因此无法启动（改选其它强度或清空此项）。",
      "row.saveFailed": "保存失败，请重试。",
      "row.toastSaved": "子代理默认模型设置已保存。",
      "row.failoverEnabled": "连接失败时按队列与策略切换模型",
      "row.failoverHint": "（需配置 ≥2 个 Provider，切换才会生效）。",
      "row.trajectoryModel": "当前供应商/模型",
      "row.chatModelInitial": "当前供应商/模型",
      "row.chatModelChange": "已切换到",
      "row.chatModelResume": "继续使用",
      "row.noticeLabel": "上下文注入 · dsh-subagent-default-model"
    };
    var SUBAGENT_ROW_EN = {
      "row.title": "Subagent default model (dsh-subagent-default-model)",
      "row.desc": "Choose one or more default routes for subagent / subagent_fork; clear them to inherit the parent session route.",
      "row.provider": "Provider",
      "row.model": "Model",
      "row.effort": "Reasoning strength",
      "row.add": "Add model",
      "row.remove": "Remove model",
      "row.strategy": "Distribution",
      "row.roundRobin": "Round-robin",
      "row.random": "Random",
      "row.inherit": "(inherit parent route)",
      "row.effortDefault": "Default",
      "row.empty": "No default model is selected; subagents inherit the parent route.",
      "row.discard": "Discard",
      "row.expand": "Expand",
      "row.collapse": "Collapse",
      "row.cheer": "Star on GitHub",
      "row.save": "Save",
      "row.saving": "Saving…",
      "row.saved": "Saved",
      "row.incomplete": "Choose a provider and model for every route.",
      "row.effortNoDeclaration": "This model declares no reasoning efforts right now; subagents will fail to issue any request with the configured effort (clear it or pick another model).",
      "row.effortNotDeclared": "This model does not declare the \"{effort}\" reasoning effort right now; subagents will fail to start (pick another effort or clear it).",
      "row.saveFailed": "Could not save the setting. Try again.",
      "row.toastSaved": "Subagent default model settings saved.",
      "row.failoverEnabled": "Switch models by queue and strategy on connection failure",
      "row.failoverHint": "(requires at least 2 configured providers).",
      "row.trajectoryModel": "Current provider/model",
      "row.chatModelInitial": "Current provider/model",
      "row.chatModelChange": "Switched to",
      "row.chatModelResume": "Resumed on",
      "row.noticeLabel": "Context injection · dsh-subagent-default-model"
    };

    // ── helpers ──────────────────────────────────────────────────────────
    // This plugin's DECLARED Loader entry id = `cordis.patch.yml` `insert.id`.
    // It is the 0.1.7 settings namespace (the plugin's own `Config` is the
    // settings section), and only the fallback here: the Desktop host mounts
    // community bundles as `include:<name>` and `configForms.get()` matches the
    // served-namespace directory EXACTLY. Binding a namespace nothing serves
    // fails silently (`status: unavailable`, no error), so the card would simply
    // never show its values. The real id is resolved by `subagentEntryIdOf()`.
    var SUBAGENT_MODEL_SETTINGS_NS = "dsh-subagent-default-model";

    /**
     * Resolve the settings namespace the host actually serves for this plugin.
     *
     * Match order: the declared entry id exactly, then a `include:`-prefixed
     * form of it, then the host-served namespace carrying the package name.
     * The legacy section name (`subagent-default-model`, pre-0.1.7
     * `settings.yaml` keying) is deliberately accepted last, so it can only win
     * when it is genuinely the served namespace. Falls back to the declared id
     * while the mirror is not ready.
     *
     * @param {object} forms - the `configForms` client service.
     * @param {Set<string>} [servedNamespaces] - authoritative served-namespace set
     *   handed over by `configForms.whileServed(...)`. When present it is preferred
     *   over the mirror snapshot, because it is the very set that decided the
     *   registration was due — the mirror may still be mid-fold.
     * @returns {string} the namespace to pass to `forms.get()`.
     */
    function subagentEntryIdOf(forms, servedNamespaces) {
      var pick = function (names) {
        return names.find(function (ns) {
          return ns === SUBAGENT_MODEL_SETTINGS_NS;
        }) ?? names.find(function (ns) {
          return ns === "include:" + SUBAGENT_MODEL_SETTINGS_NS;
        }) ?? names.find(function (ns) {
          return /subagent-default-model/i.test(ns || "");
        });
      };
      try {
        if (servedNamespaces && typeof servedNamespaces.has === "function") {
          var fromServed = pick(Array.from(servedNamespaces));
          if (typeof fromServed === "string" && fromServed !== "") return fromServed;
        }
        var view = forms.describe().getSnapshot().view;
        var namespaces = ((view && view.namespaces) || []).map(function (entry) {
          return entry && entry.ns;
        });
        var served = pick(namespaces);
        if (typeof served === "string" && served !== "") return served;
      } catch (_e) { /* mirror not ready: the declared id is still the right guess */ }
      return SUBAGENT_MODEL_SETTINGS_NS;
    }

    function normalizeDefaultModels(value) {
      var result = [];
      if (Array.isArray(value.models) && value.models.length > 0) {
        for (var i = 0; i < value.models.length; i++) {
          var entry = value.models[i];
          if (typeof entry === "string") result.push({ provider: value.provider || "", model: entry, reasoningEffort: "" });
          else if (entry && typeof entry === "object") result.push({ provider: entry.provider || value.provider || "", model: entry.model || "", reasoningEffort: entry.reasoningEffort || "" });
        }
      } else if (value.provider || value.model) {
        result.push({ provider: value.provider || "", model: value.model || "", reasoningEffort: value.reasoningEffort || "" });
      }
      return result;
    }

    function serializeDefaultModels(previousValue, routes, strategy, failoverEnabled) {
      var next = Object.assign({}, previousValue || {});
      next.failoverEnabled = failoverEnabled === false ? false : true;
      if (routes.length === 0) {
        next.provider = "";
        next.model = "";
        next.models = [];
        next.strategy = "round-robin";
        delete next.reasoningEffort;
        return next;
      }
      var provider = routes[0].provider;
      var sharedEffort = routes[0].reasoningEffort;
      var allSameEffort = routes.every(function (route) { return route.reasoningEffort === sharedEffort; });
      next.provider = provider;
      next.model = "";
      next.models = routes.map(function (route) {
        if (route.provider === provider && !route.reasoningEffort) {
          return route.model;
        }
        var base = { provider: route.provider, model: route.model };
        if (route.reasoningEffort) {
          base.reasoningEffort = route.reasoningEffort;
        }
        return base;
      });
      next.strategy = strategy === "random" ? "random" : "round-robin";
      if (allSameEffort && sharedEffort) {
        next.reasoningEffort = sharedEffort;
      } else {
        delete next.reasoningEffort;
      }
      return next;
    }

    // ── effort capability check ──────────────────────────────────────────
    // A configured `reasoningEffort` that the target model does not declare
    // makes every delegation fail before its first request: the harness
    // assembles no system prompt and injects no context, so the subagent looks
    // like "nothing was injected". The provider catalog is the only source of
    // truth for that capability, and it can lag (a model may declare efforts
    // only after its directory refreshes). Report the mismatch in the panel so
    // the user learns it before saving, instead of diagnosing a silent failure.
    //
    // Pure: given one route and the loaded catalog groups, return the
    // diagnostic key + params, or null when the route is fine or unknown.
    // An unknown provider/model yields null: an absent catalog entry must
    // never be reported as "unsupported" (the model may be valid but simply
    // not advertised yet).
    function checkEffortSupport(route, groups) {
      if (!route || !route.provider || !route.model) return null;
      if (!route.reasoningEffort) return null;
      if (!Array.isArray(groups)) return null;
      var group = null;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i] && groups[i].id === route.provider) { group = groups[i]; break; }
      }
      if (!group || !Array.isArray(group.models)) return null;
      var model = null;
      for (var j = 0; j < group.models.length; j++) {
        if (group.models[j] && group.models[j].id === route.model) { model = group.models[j]; break; }
      }
      if (!model) return null;
      var reasoning = model.reasoning;
      var efforts = reasoning && Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
      if (efforts.length === 0) return { key: "row.effortNoDeclaration", params: {} };
      for (var k = 0; k < efforts.length; k++) {
        if (efforts[k] && efforts[k].id === route.reasoningEffort) return null;
      }
      return { key: "row.effortNotDeclared", params: { effort: route.reasoningEffort } };
    }

    function persistDefaultModels(scope, value) {
      return Promise.resolve().then(function () { return scope.set("provider", value.provider); }).then(function () {
        return scope.set("model", value.model);
      }).then(function () {
        return scope.set("models", value.models);
      }).then(function () {
        return scope.set("strategy", value.strategy);
      }).then(function () {
        return scope.set("failoverEnabled", value.failoverEnabled === false ? false : true);
      }).then(function () {
        return scope.set("reasoningEffort", value.reasoningEffort || "");
      });
    }

    function useSettingsScopeSnapshot(scope) {
      var snapshotState = React.useState(scope.getSnapshot());
      React.useEffect(function () {
        function update() { snapshotState[1](scope.getSnapshot()); }
        return scope.subscribe(update);
      }, [scope]);
      return snapshotState[0];
    }

    // ── SubagentModelRow component ───────────────────────────────────────
    function SubagentModelRow(props) {
      var t = props.t;
      var snap = useSettingsScopeSnapshot(props.settingsScope);
      var value = (snap && snap.status === "ready" && snap.value) || {};
      var groupsState = React.useState([]);
      var routesState = React.useState(normalizeDefaultModels(value));
      var strategyState = React.useState(value.strategy === "random" ? "random" : "round-robin");
      var failoverEnabledState = React.useState(value.failoverEnabled !== false);
      var savedState = React.useState(false);
      var saveErrorState = React.useState(false);
      var toastState = React.useState(null);
      var toastSeq = React.useRef(0);
      var dirtyState = React.useState(false);
      var busyState = React.useState(false);
      React.useEffect(function () {
        var alive = true;
        props.loadCatalog().then(function (groups) {
          if (alive) groupsState[1](groups);
        }).catch(function () {});
        return function () { alive = false; };
      }, []);
      React.useEffect(function () {
        if (dirtyState[0] || busyState[0]) return;
        routesState[1](normalizeDefaultModels(value));
        strategyState[1](value.strategy === "random" ? "random" : "round-robin");
        failoverEnabledState[1](value.failoverEnabled !== false);
        savedState[1](false);
        saveErrorState[1](false);
      }, [snap ? snap.revision : -1, dirtyState[0], busyState[0]]);
      function updateRoute(index, field, nextValue) {
        routesState[1](function (routes) {
          return routes.map(function (route, routeIndex) {
            if (routeIndex !== index) return route;
            var next = { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort || "" };
            next[field] = nextValue;
            if (field === "provider") {
              next.model = "";
              next.reasoningEffort = "";
            }
            return next;
          });
        });
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function addRoute() {
        var firstGroup = groupsState[0][0];
        routesState[1](function (routes) {
          return routes.concat({ provider: firstGroup ? firstGroup.id : "", model: "", reasoningEffort: "" });
        });
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function removeRoute(index) {
        routesState[1](function (routes) { return routes.filter(function (_, routeIndex) { return routeIndex !== index; }); });
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function save() {
        if (!snap || snap.status !== "ready" || snap.writable === false || busyState[0]) return;
        var nextValue = serializeDefaultModels(value, routesState[0], strategyState[0], failoverEnabledState[0]);
        savedState[1](false);
        saveErrorState[1](false);
        busyState[1](true);
        Promise.resolve().then(function () {
          return props.write(nextValue);
        }).then(function () {
          var accepted = props.settingsScope.getSnapshot();
          var acceptedValue = (accepted && accepted.status === "ready" && accepted.value) || {};
          if (acceptedValue.provider !== nextValue.provider || acceptedValue.model !== nextValue.model || acceptedValue.strategy !== nextValue.strategy || (acceptedValue.reasoningEffort || "") !== (nextValue.reasoningEffort || "") || (acceptedValue.failoverEnabled === false ? false : true) !== nextValue.failoverEnabled || JSON.stringify(acceptedValue.models || []) !== JSON.stringify(nextValue.models || [])) {
            throw new Error("settings write was not accepted");
          }
          routesState[1](normalizeDefaultModels(acceptedValue));
          strategyState[1](acceptedValue.strategy === "random" ? "random" : "round-robin");
          failoverEnabledState[1](acceptedValue.failoverEnabled !== false);
          dirtyState[1](false);
          busyState[1](false);
          savedState[1](true);
          toastSeq.current = toastSeq.current + 1;
          toastState[1]({ seq: toastSeq.current, text: t("row.toastSaved") });
        }).catch(function () {
          busyState[1](false);
          saveErrorState[1](true);
        });
      }
      function discard() {
        routesState[1](normalizeDefaultModels(value));
        strategyState[1](value.strategy === "random" ? "random" : "round-robin");
        failoverEnabledState[1](value.failoverEnabled !== false);
        dirtyState[1](false);
        savedState[1](false);
        saveErrorState[1](false);
        toastState[1](null);
      }
      var hasIncompleteRoute = routesState[0].some(function (route) { return !route.provider || !route.model; });
      var effortWarnings = [];
      routesState[0].forEach(function (route, index) {
        var warning = checkEffortSupport(route, groupsState[0]);
        if (warning !== null) effortWarnings.push({ index: index, key: warning.key, warning: warning });
      });
      var saveDisabled = !snap || snap.status !== "ready" || snap.writable === false || busyState[0] || hasIncompleteRoute || !dirtyState[0];
      var discardDisabled = !dirtyState[0] || busyState[0];
      var routes = routesState[0].map(function (route, index) {
        var group = null;
        for (var groupIndex = 0; groupIndex < groupsState[0].length; groupIndex++) {
          if (groupsState[0][groupIndex].id === route.provider) { group = groupsState[0][groupIndex]; break; }
        }
        var providerChoices = groupsState[0].slice();
        if (route.provider && !group) providerChoices.unshift({ id: route.provider, name: route.provider });
        var modelChoices = group ? (group.models || []).slice() : [];
        if (route.model && !modelChoices.some(function (candidate) { return candidate.id === route.model; })) {
          modelChoices.unshift({ id: route.model, name: route.model });
        }
        var selectedModel = null;
        for (var modelIndex = 0; modelIndex < modelChoices.length; modelIndex++) {
          if (modelChoices[modelIndex].id === route.model) { selectedModel = modelChoices[modelIndex]; break; }
        }
        var effortChoices = selectedModel && selectedModel.reasoning && Array.isArray(selectedModel.reasoning.efforts) ? selectedModel.reasoning.efforts.slice() : [];
        if (route.reasoningEffort && !effortChoices.some(function (candidate) { return candidate.id === route.reasoningEffort; })) {
          effortChoices.unshift({ id: route.reasoningEffort, name: route.reasoningEffort });
        }
        // Non-blocking capability warning: saving is still allowed (a catalog
        // that has not refreshed yet must not trap the user), but a mismatch is
        // surfaced here rather than discovered later as a subagent that starts
        // no request at all.
        var effortWarning = checkEffortSupport(route, groupsState[0]);
        return React.createElement("div", { className: "dsm-model-settings-route", key: index },
          React.createElement("label", { className: "dsm-model-settings-field" },
            t("row.provider"),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: route.provider,
              onChange: function (event) { updateRoute(index, "provider", event.target.value); }
            },
              React.createElement("option", { value: "" }, t("row.inherit")),
              providerChoices.map(function (candidate) {
                return React.createElement("option", { key: candidate.id, value: candidate.id }, candidate.name + " (" + candidate.id + ")");
              })
            )
          ),
          React.createElement("label", { className: "dsm-model-settings-field" },
            t("row.model"),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: route.model,
              disabled: !route.provider,
              onChange: function (event) { updateRoute(index, "model", event.target.value); }
            },
              React.createElement("option", { value: "" }, t("row.inherit")),
              modelChoices.map(function (candidate) {
                return React.createElement("option", { key: candidate.id, value: candidate.id }, candidate.name || candidate.id);
              })
            )
          ),
          React.createElement("label", { className: "dsm-model-settings-field" },
            t("row.effort"),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: route.reasoningEffort || "",
              disabled: !route.model,
              onChange: function (event) { updateRoute(index, "reasoningEffort", event.target.value); }
            },
              React.createElement("option", { value: "" }, t("row.effortDefault")),
              effortChoices.map(function (candidate) {
                return React.createElement("option", { key: candidate.id, value: candidate.id }, candidate.name || candidate.id);
              })
            )
          ),
          React.createElement("button", {
            className: "dsm-model-settings-remove",
            type: "button",
            "aria-label": t("row.remove"),
            title: t("row.remove"),
            onClick: function () { removeRoute(index); }
          }, "\u00d7"),
          effortWarning === null ? null : React.createElement("div", {
            className: "dsm-model-settings-warn",
            role: "status",
            "data-effort-warning": effortWarning.key
          }, t(effortWarning.key, effortWarning.params))
        );
      });
      return React.createElement("section", { className: "dsm-model-settings" },
        routes.length ? React.createElement("div", { className: "dsm-model-settings-list" }, routes) : React.createElement("div", { className: "dsm-model-settings-hint" }, t("row.empty")),
        React.createElement("div", { className: "dsm-model-settings-options" },
          React.createElement("button", { type: "button", className: "dsm-btn dsm-btn-outline", onClick: addRoute }, t("row.add")),
          routes.length > 1 ? React.createElement("div", { className: "dsm-model-settings-strategy" },
            React.createElement("span", null, t("row.strategy")),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: strategyState[0],
              onChange: function (event) { strategyState[1](event.target.value); savedState[1](false); saveErrorState[1](false); dirtyState[1](true); }
            },
              React.createElement("option", { value: "round-robin" }, t("row.roundRobin")),
              React.createElement("option", { value: "random" }, t("row.random"))
            )
          ) : null
        ),
        React.createElement("label", { className: "dsm-model-settings-failover" },
          React.createElement("input", {
            type: "checkbox",
            checked: failoverEnabledState[0],
            onChange: function (event) { failoverEnabledState[1](event.target.checked); savedState[1](false); saveErrorState[1](false); dirtyState[1](true); }
          }),
          React.createElement("span", null, t("row.failoverEnabled")),
          React.createElement("span", { className: "dsm-failover-hint" }, t("row.failoverHint"))
        ),
        hasIncompleteRoute ? React.createElement("div", { className: "dsm-model-settings-hint" }, t("row.incomplete")) : null,
        effortWarnings.length === 0 ? null : React.createElement("div", {
          className: "dsm-model-settings-warn-list",
          role: "status",
          "data-effort-warning-count": String(effortWarnings.length)
        }, effortWarnings.map(function (entry) {
          return React.createElement("div", { key: entry.key + ":" + entry.index }, t(entry.warning.key, entry.warning.params));
        })),
        React.createElement("div", { className: "dsm-model-settings-footer" },
          React.createElement("div", { className: "dsm-model-settings-footer-left" },
            React.createElement("a", {
              className: "dsm-model-settings-cheer",
              href: DSM_GITHUB_URL,
              target: "_blank",
              rel: "noopener noreferrer"
            },
              t("row.cheer"),
              React.createElement("span", { className: "dsm-model-settings-cheer-star", "aria-hidden": "true" }, "\u2605")
            )
          ),
          React.createElement("button", { type: "button", className: "dsm-btn dsm-btn-outline", disabled: discardDisabled, onClick: discard }, t("row.discard")),
          React.createElement("button", { type: "button", className: "dsm-btn dsm-btn-primary", disabled: saveDisabled, onClick: save }, busyState[0] ? t("row.saving") : t("row.save"))
        ),
        toastState[0] ? React.createElement(Toast, { key: toastState[0].seq, text: toastState[0].text, onDone: function () { toastState[1](null); } }) : null
      );
    }

    // ── SubagentModelCard: collapsible card shell (default collapsed) ─────
    function SubagentModelCard(props) {
      // Family pattern (dsh-ldvh / dsh-connect-workbuddy / dsh-sub-cli): on the
      // Plugins page a card is asked for `view: 'summary'` (a one-line glance)
      // or `view: 'page'` (the form itself). Only the page form should default
      // to open — collapsing a summary keeps the list scannable, while an
      // unopened page form hides the settings the user came for.
      if (props.view === "summary") return props.t("row.desc");
      var openState = React.useState(props.view === "page");
      var open = openState[0];
      var setOpen = openState[1];
      var t = props.t;
      var title = t("row.title");
      var description = t("row.desc");
      return React.createElement("li", { className: "dsm-plugin-card" + (open ? " dsm-plugin-card-open" : "") },
        React.createElement("button", {
          type: "button",
          className: "dsm-plugin-card-header",
          "aria-expanded": open,
          "aria-label": t(open ? "row.collapse" : "row.expand") + ": " + title,
          onClick: function () { setOpen(!open); }
        },
          React.createElement("img", { className: "dsm-plugin-card-icon", src: DSM_ICON, alt: "" }),
          React.createElement("span", { className: "dsm-plugin-card-head" },
            React.createElement("span", { className: "dsm-plugin-card-title" }, title),
            React.createElement("span", { className: "dsm-plugin-card-description" }, description)
          ),
          React.createElement("span", { className: "dsm-plugin-card-chevron" + (open ? " dsm-plugin-card-chevron-open" : "") }, IconChevronDown ? React.createElement(IconChevronDown, { size: 14 }) : React.createElement("span", { className: "dsm-plugin-card-caret" }, "▾"))
        ),
        React.createElement("div", { className: "dsm-plugin-card-body", hidden: !open },
          React.createElement(SubagentModelRow, props)
        )
      );
    }

    // ── 对话流注入行的渲染器（自有节点 kind）─────────────────────────────
    //
    // 宿主按 `entryKey = node.kind` 从 `conversation.chat.node` 槽位**运行时分派**
    // 渲染器（`ChatNodeSeat` 传 `entryKey: routedNode.kind`）。该分派是 keyed 槽位：
    // 没有占用者的 kind 走 `ChatNodeSeat` 传入的 `fallback`——一个 `JsonBlock`
    // （标签 "unknown surface" + 节点数据原样 JSON）。所以只改 kind 而不注册渲染器
    // 不是「行消失」，而是**对话流里出现一行原始 JSON**（比不可见更糟）。
    //
    // 渲染器收到的是 `{ node }`（`ChatNodeOwnerProps`），节点数据即 `start()` 的
    // state（`buildViewNode` 把它放进 `data`）。这里只读 content / source.summary，
    // 不依赖任何宿主内部工具。
    function SubagentModelNoticeRow(props) {
      var node = props.node;
      var data = node && node.data ? node.data : {};
      // `t` is the framework-injected locale seat: this registration declares
      // `locale:`, so the renderer receives it. Keep the label in the
      // dictionary rather than inlining one language (the plugin ships zh+en).
      var t = props.t || function (key) { return key; };
      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var blocks = Array.isArray(data.content) ? data.content : [];
      var text = blocks.map(function (block) {
        return block && typeof block.text === "string" ? block.text : "";
      }).join("\n");
      var summary = data.source && typeof data.source.summary === "string" ? data.source.summary : "";
      return React.createElement("div", { className: "dsm-notice-row" },
        React.createElement("button", {
          type: "button",
          className: "dsm-notice-toggle",
          "aria-expanded": open,
          onClick: function () { setOpen(!open); }
        },
          React.createElement("span", { className: "dsm-notice-dot", "aria-hidden": "true" }),
          React.createElement("span", { className: "dsm-notice-label" }, t("row.noticeLabel")),
          summary ? React.createElement("span", { className: "dsm-notice-summary" }, summary) : null
        ),
        open ? React.createElement("pre", { className: "dsm-notice-body" }, text) : null
      );
    }

    /** 注册自有 kind 的渲染器；返回卸载函数。槽位缺失时静默跳过。 */
    function registerSubagentModelNotice(ctx) {
      try {
        return ctx.slots.inject("conversation.chat.node", function () {
          return ctx.slots.register({
            name: "conversation.chat.node",
            key: CHAT_MODEL_NODE_KIND,
            locale: SUBAGENT_ROW_LOCALE
          }, SubagentModelNoticeRow);
        });
      } catch (error) {
        console.error("[dsh-subagent-default-model] notice renderer failed to register (chat row absent):", error);
        return function () { };
      }
    }

    // ── apply: inject settings row ───────────────────────────────────────
    // `settingsScope` service was REMOVED in DSH 0.1.7 (settings moved to
    // `configForms` + the plugin's own `Config`). Hard-injecting it would keep
    // this whole client plugin from ever applying.
    //
    // `uiConversation` MUST be declared here, not merely read behind a guard:
    // Cordis does not return `undefined` for an undeclared service — reading
    // `ctx.uiConversation` THROWS `cannot get property "uiConversation" without
    // inject`. Because that read sits in the middle of `apply()`, the throw
    // aborted everything AFTER it — including the `ctx.inject(["configForms"])`
    // block that registers the settings card, so the Plugins page showed no
    // configuration section at all. A `if (ctx.foo && …)` guard cannot protect
    // this: evaluating `ctx.foo` is itself the failure.
    //
    // All seven official consumers (ui-chat / ui-plan / ui-deliverables / …)
    // declare it for exactly this reason. Declaring it is safe: the renderer
    // mounts this plugin only once every dependency is available, and
    // `uiConversation` ships in the same client bundle set as `slots`/`locale`,
    // so it cannot be selectively absent while those are present.
    //
    // `configForms` stays soft (via `ctx.inject`) — unlike `uiConversation` it
    // is optional by design, and `ctx.inject` is the API that waits for it
    // without throwing.
    var inject = ["slots", "locale", "uiConversation"];

    function apply(ctx) {
      // The old `connection.api.llm.models()` seat no longer exists. The current
      // model catalog lives on the `remote.session` namespaced service.
      //
      // `remote.session` is mounted ASYNCHRONOUSLY by `remote.$mount()`
      // (`packages/api/gateway/src/client/index.ts`: `remoteServiceKey(ns)` →
      // `remote.<ns>`, mounted from an async `$mount`). Reading it ONCE during
      // `apply` therefore usually captures `undefined` when the gateway has not
      // finished mounting yet — and because the value was captured, the catalog
      // stayed empty for the lifetime of the page. That is what left the
      // Provider/Model dropdowns permanently blank.
      //
      // Resolve it lazily on EVERY call instead, so a late mount is picked up.
      // `remote` is held as the lookup root rather than the leaf so the leaf is
      // re-read per call. The official sibling card declares
      // `inject: ['…','remote','remote.session',…]` to have Cordis wait for it;
      // we stay soft-injected (a missing gateway must not withhold the card)
      // and re-probe instead.
      var remoteRoot = typeof ctx.get === "function" ? ctx.get("remote") : undefined;
      var loadCatalog = function () {
        var sessionRemote = ctx.get ? ctx.get("remote.session") : undefined;
        if (!sessionRemote) sessionRemote = remoteRoot && remoteRoot.session;
        if (!sessionRemote || typeof sessionRemote.modelCatalog !== "function") return Promise.resolve([]);
        return sessionRemote.modelCatalog().then(function (response) {
          if (!response || !response.ok) return [];
          return (response.value && response.value.groups) || [];
        }).catch(function () { return []; });
      };

      // Register locale for this component.
      //
      // The host `locale` service THROWS when a namespace already holds a locale
      // (`dsh-client-locale`: `locale namespace "…" already has locale "…"`), and
      // Cordis keeps a fiber's registrations alive while `apply` re-runs for its
      // replacement. Registering unconditionally therefore makes the SECOND
      // apply() of this plugin throw at the top of the function — before either
      // card is registered — so the client half never activates and web boot
      // reports `dsh-subagent-default-model: failed`.
      //
      // `ctx.effect` ties the registration to the current fiber: Cordis disposes
      // it before running the replacement, so a re-apply starts from a clean
      // namespace. Same pattern as `dsh-ldvh`/`dsh-sub-cli`.
      ctx.effect(function () {
        var offZh = ctx.locale.register(SUBAGENT_ROW_LOCALE, "zh", SUBAGENT_ROW_ZH);
        var offEn = ctx.locale.register(SUBAGENT_ROW_LOCALE, "en", SUBAGENT_ROW_EN);
        return function () {
          if (typeof offZh === "function") offZh();
          if (typeof offEn === "function") offEn();
        };
      }, "dsh-subagent-default-model: settings copy");

      // ── trajectory: surface the subagent model per request ──────────────
      // agent-loop appends a `request/context` frame (provider/model) whenever
      // the provider or model changes — failover switches trigger it with zero
      // host changes. Register a trajectory definition that renders that frame
      // as a compact "Current provider/model" row inside the subagent's trajectory view.
      if (ctx.uiConversation && ctx.uiConversation.events && typeof ctx.uiConversation.events.register === "function") {
        var trajectoryT = ctx.locale.bind(SUBAGENT_ROW_LOCALE);
        var modelContextDefinition = {
          kind: "trajectory-subagent-model",
          target: "trajectory",
          match: function (event) {
            return event.type === "request/context" ? { id: String(event.seq), role: "start" } : null;
          },
          start: function (_context, match) {
            var event = match.event;
            var data = event.data || {};
            var label = trajectoryT("row.trajectoryModel") + "：" + (data.provider ? data.provider + (data.model ? "/" + data.model : "") : (data.model || ""));
            return {
              kind: "context",
              seq: event.seq,
              time: event.time,
              content: [{ type: "text", text: label }],
              source: { kind: "plugin:dsh-subagent-default-model", form: "notice" }
            };
          },
          update: function (context) { return context.state; },
          buildViewNode: function (context) {
            if (context.state === void 0) return null;
            return {
              key: context.key,
              kind: context.kind,
              id: context.id,
              target: "trajectory",
              anchorSeq: context.state.seq,
              location: context.start && context.start.location ? context.start.location : { kind: "unresolved" },
              data: { kind: "node", node: context.state }
            };
          }
        };
        // `ctx.effect` ties the registration to this fiber, so Cordis disposes it
        // before re-running `apply` for a replacement fiber. Registering BARE is
        // wrong here: `ConversationEventRegistry.register` throws
        // `conversation Definition "<kind>" is already registered` on a duplicate
        // kind, so the second apply would abort — taking the settings-card
        // registration below it down with it. Every official consumer wraps this
        // in `ctx.effect` (ui-plan, ui-deliverables, …).
        ctx.effect(function () {
          return ctx.uiConversation.events.register(modelContextDefinition);
        }, "dsh-subagent-default-model: trajectory model row");

        // ── chat: surface the subagent model in the conversation view ──
        // agent-loop writes a `request/header` frame with a `reason` the first
        // time the subagent builds a request ("initial"), on every provider /
        // model change ("change" — including failover switches), and when a
        // persisted session resumes ("resume"). The frame header carries the
        // full config (provider/model), so the conversation can show exactly
        // which route is in use — no host-side changes required.
        // 节点 kind 用**自有值**（`CHAT_MODEL_NODE_KIND`），不复用内置 `context`。
        // 旧注释曾写「复用内置注入行（ContextMessageNodeView）」——该复用目标在
        // 宿主 0.1.7 已不存在：`dsh-client-ui-chat` 的 `isVisibleChatNode()` 明确
        // 排除 `node.kind === "context"`（除非含 tool-addition/removal 块），故
        // 复用 `context` 的结果是**行永远不可见**。自有 kind 不在黑名单内，配一个
        // 自有渲染器即可见。trajectory 侧不受影响（该黑名单只在 ui-chat）。
        var chatT = ctx.locale.bind(SUBAGENT_ROW_LOCALE);
        var chatModelDefinition = {
          kind: "chat-subagent-model",
          target: "chat",
          match: function (event) {
            if (event.type !== "request/header") return null;
            // DSH 0.1.2 also appends a "series" header when a follow-up
            // turn starts a new request series with an UNCHANGED config:
            // no route change to surface, and claiming it would add one
            // redundant "Current provider/model" row per turn.
            if ((event.data || {}).reason === "series") return null;
            return { id: String(event.seq), role: "start" };
          },
          start: function (_context, match) {
            var event = match.event;
            var data = event.data || {};
            var header = data.header || {};
            var config = header.config || {};
            var reason = data.reason === "change" ? "row.chatModelChange" : data.reason === "resume" ? "row.chatModelResume" : "row.chatModelInitial";
            var label = chatT(reason) + "：" + (config.provider ? config.provider + (config.model ? "/" + config.model : "") : (config.model || ""));
            return {
              kind: CHAT_MODEL_NODE_KIND,
              seq: event.seq,
              time: event.time,
              content: [{ type: "text", text: label }],
              // `summary` is the collapsed row's one-line account (notice form):
              // without it the row only shows the provenance label and hides the
              // model behind expansion.
              source: { kind: "plugin:dsh-subagent-default-model", form: "notice", summary: label },
              provenance: { role: "inject", label: "dsh-subagent-default-model" },
              form: "notice"
            };
          },
          update: function (context) { return context.state; },
          buildViewNode: function (context) {
            if (context.state === void 0) return null;
            return {
              key: context.key,
              kind: CHAT_MODEL_NODE_KIND,
              id: context.id,
              target: "chat",
              anchorSeq: context.state.seq,
              location: context.start && context.start.location ? context.start.location : { kind: "unresolved" },
              visibility: "visible",
              data: context.state
            };
          }
        };
        ctx.effect(function () {
          return ctx.uiConversation.events.register(chatModelDefinition);
        }, "dsh-subagent-default-model: chat model row");

        // 自有节点 kind 必须配自己的渲染器（宿主按 `entryKey = node.kind` 分派）。
        // 缺这一步，该行会落到 `ChatNodeSeat` 的 `fallback`（JsonBlock）——用户看到
        // 的不是「模型行」，而是一坨原始 JSON。
        ctx.effect(function () {
          return registerSubagentModelNotice(ctx);
        }, "dsh-subagent-default-model: chat notice row");
      }

      // Resolve the settings scope for this plugin. On DSH 0.1.7+ the settings
      // surface is the plugin's own Loader entry id (`dsh-subagent-default-model`),
      // served by the `configForms` client service (replacing the removed
      // `settingsScope.bind({namespace})`). The namespace the Host actually
      // serves is host-chosen (Desktop mounts it as `include:dsh-subagent-default-model`),
      // so probe the mirror directory and fall back to the declared id rather
      // than guessing — a wrong guess binds to a namespace nothing serves.
      var subagentScope = null;
      var subagentRowInjected = function () {
        return {
          settingsScope: subagentScope,
          loadCatalog: loadCatalog,
          write: function (value) {
            return persistDefaultModels(subagentScope, value);
          }
        };
      };

      // `configForms` is the 0.1.7 client settings surface; soft-inject it so the
      // card simply stays absent when the service is unavailable, instead of
      // blocking the whole client plugin.
      //
      // Register through `whileServed`, NOT a one-shot `forms.get(...)`.
      // The describe mirror loads ASYNCHRONOUSLY (`mirror.ensure()`), so a probe
      // run during `apply` can execute before `view` exists. `subagentEntryIdOf`
      // then sees zero namespaces and falls back to the declared entry id
      // (`dsh-subagent-default-model`) while the Desktop host actually serves
      // `include:dsh-subagent-default-model`. The mismatch makes the host's
      // `ConfigFormController.derive()` park the form at `status: 'unavailable'`
      // — silently, with no error — and `derive()` only re-runs on a mirror
      // change. Because the scope was already captured, the card stayed
      // unavailable FOREVER and its Save button was permanently disabled
      // (`saveDisabled` includes `snap.status !== 'ready'`).
      //
      // `whileServed` re-invokes the registration each time one of the watched
      // namespaces enters the mirror, and hands it the served set — so the
      // namespace is resolved from the authoritative directory at the moment it
      // actually exists. It also disposes the contribution when the namespace
      // goes away. Every official consumer registers this way.
      ctx.inject(["configForms"], function (formsCtx) {
        var forms = formsCtx.configForms;

        var registerCards = function (namespace) {
          subagentScope = forms.get(namespace);
          var disposers = [];
          var registerCard = function (slotName, key) {
            try {
              disposers.push(ctx.slots.inject(slotName, function () {
                return ctx.slots.register({
                  name: slotName,
                  key: key,
                  locale: SUBAGENT_ROW_LOCALE,
                  inject: subagentRowInjected
                }, SubagentModelCard);
              }));
            } catch (error) {
              console.error('[dsh-subagent-default-model] settings card slot "' + slotName + '" failed to register (host provider unaffected):', error);
            }
          };
          // 0.1.7 placement: register under Plugins config surfaces (the old
          // `settings.plugin.item` slot was removed in 0.1.7).
          registerCard("plugins.bundle.config", "dsh-subagent-default-model");
          registerCard("plugins.row.config", "dsh-subagent-default-model#dsh-subagent-default-model");
          return function () {
            while (disposers.length) {
              var off = disposers.pop();
              if (typeof off === "function") off();
            }
            subagentScope = null;
          };
        };

        // `whileServed` is the 0.1.7 contract. Fall back to a direct registration
        // only if a host somehow lacks it, so the card still appears.
        if (typeof forms.whileServed === "function") {
          ctx.effect(function () {
            return forms.whileServed(
              [SUBAGENT_MODEL_SETTINGS_NS, "include:" + SUBAGENT_MODEL_SETTINGS_NS],
              function (served) {
                return registerCards(subagentEntryIdOf(forms, served));
              }
            );
          }, "dsh-subagent-default-model: settings cards follow the served namespace");
        } else {
          registerCards(subagentEntryIdOf(forms));
        }
      });
    }

    // `checkEffortSupport` is exported as a pure test seam (same convention as
    // the host half's `settingsSectionInstaller`); the module loader only reads
    // `apply` / `inject`.
    return { apply: apply, inject: inject, checkEffortSupport: checkEffortSupport };
  }
});
