// dsh-subagent-default-model client — settings panel for the subagent default model.
// Extracted from @aaravarr/dsh-subagent-max (licensed MIT) and adapted as a
// standalone client entry for this plugin.

window.__ModuleLoader__.load({
  id: "dsh-subagent-default-model",
  factory: function (require) {
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Toast = primitives.Toast;

    // ── plugin icon (LD brand logo, 64px) ────────────────────────────────
    var DSM_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAXGUlEQVR4nH1bC7BdVXn+1tr7nHPvzb3JvUloSAQp0JHWoAMttKOCFrWU8irQSbCTQYG21IahnTJUUTsM0FJhZCzCSIcKImOpDkhrhQ5YC7ROB3lUBU3EyCuBFBIIedzcx3ntvTr/a621TwIns3PO3mfvddf/+v7v/9c6DvYKoYBz1cZNYfJpVBcNBm7dcIhj3TBM15VzqAE6XAWEGggVADroOl0byDW+PtRr9E732rl9r2PxOMNsrCogVE7PA0Kge4Lcz5/TGI6v00UaK+h98u4QUA9quIDg4Pe2i2LTsknc++mzZu9cv37VHNaFAveSJICj/9aFUNzrXHXSTwdnznl/Y+X9MaEP1D0A/ToKaUdDASoAK0YVYcLad/G88S6C1aQcOkI2Nj9HylBFBRMYqPUeFp6EDXQfKcIUoud6LQQP59rwrsBEOdhy9KGDK/7j9mUPmBKcCf++Z4YbF6eKLw+6QFioKl/DoYILlXMsHE2KPCCzwlsqoNb3oUw4Kq+2a0k4G4MtXOX3J4HNyulzUkC0eqYI8ZAaQZQSAh9080Qx1m7jHStnL/3B3ctvXbcuFOwBH/p5OG12DA/29leV6wcHeI8hadE1rBldl/6ACs7WMEuz0PIcKawe0Gdzeyf36eTzcOHxVAEpTEQB0QtY0PRZPMYsX+t3tSqBxkteYeHh6qqu6yIsmVhaHHtE7/fu/8fJhzzF/OywunXQR+DJOO9pkLp2NJ64pIXhaOxb/IfmJM29PemSJ+NSzJP1s2dhwmucJ6uaoIYFzVjnkFDhLRTkb2XC03gQTKDrZNjSV1icXwzPv9y99Z5Hw6R/psQnqoniyLBQ1d65IoGiDqZuHwWwzyFzx8xl5RDBZR4uCZc9E8fS+8TdSfHZ2KxAel6VwEIYZiflxC9NKToeKcKrAcjV2d2DK3xYqOcXJ478ytf2fcL3htWGegAaSZGeBnKixWgVPXRiZpEomLq4Kcri2RCc7zN3NWuq5XlOJLwqjq9liqlHlEfzSveIdVk0Fjh5kVjdjKLneniCtcEg7N492FBWAWvrHpwLzgmYUfySi+VorcJFBE6I7jIAjFnC3DybePKE5ClxLLsPI0q3kNAsYJ4g1wjkzDuju4nQJrx6RxRe/7YHfFX3MOyHtaUHloaKcqa4rcQTDWxubHnZ0lESNoaGXad7+RmLc7GMxbS4s8Y82S3mdhMshR+Po4pk181jkx22afHc8hL3plNTjOGDjEfu7pxfWkpcyA02Ofo6xpylPsMCi3eNTROShVawM0H4+4bXaGqzcTKQzc8j6VGPkb9tFtU56bwlBdK9ZMQMKNgolMtVKepFcq6hBMAzQJAQ6srG9iwNJRfN0LtWd64z1qZjRPDieBYQkyNTqFpCsoYoKQFoFt8xhA5icZ2fXWOwY4GScsT95Tv7XoSnd0ehgLJBSPSdkdhYWbSeAk2eCSzuScDs/qQo9dpRZarVWWm5ZRuxn8YRRabYtiwhn5PVRXD9js8FzM2rowKII7MnOJSR2GSZJMVUckfzjIjKMe2p5fOsENGfPESR38AwB8AsZTUBUV025TwWVEAsubSl6gYA8rU6eUMmvE2ErjMrQEDZQGkewGI6TcqPAhlT1hHBBV0xZC/R3B09JFmdXDESrIz5GRPMlWQA6kNAoVbjf7FAyq1vsW8xrt+rImI4aEiwIuqAMjI9y/8Z5RSAS+f04P4uTcihozDLaO6kZup2gSWFIXjm3plb75sHxkugMKzAgWmQcYmsTvqrgPkuMOgHFAhY0gnolDJfOgTM0t/xMcYTJeZz9QZRgHiUd5AQIHe2fNqIY3o4xiEw3wc++A6HvzweWNbWtKmsrF853PFEwDd/LEqoVOiYQQLQ7QGXn+Zw3okOhc9i1tw8umpS7mBQ4PW9Ab/YVuHxTTV+8EyF7TsqTHQCxtsBlVWSUVBViGYHcnMDQvaUyAv03wmPDcP8ECiy2lwOKl4CFz2+AoYDx1b73rkOayaVfUXziRMu9oGTbg54cz9pNlV9FEJzi8CJv+zwwOWWoZvZfXSst3rteDPgXx4e4LZv9fDS9grLlzotkclDakmXJCCFTswAdC5eZQqphwErZgr40QInAh4XHMbsHGt6ugSmWuLZwyqwlclFhwqOrSJgZky+izydc7bj+1ZPy7P9AT2nz/MR+PuK/g6/50fg8QdDGffQFQ4b13fwyFcmccl5HczOUgVYoXTcAGEBSWBzdRY4hoLUBvGeQGFgrM84gMWglq/mwszXqcSlAahgdi57l8/Mr9gaxiqbnZwheZMU23Lw88zN0zWff5ZzCpeyAApqTNWkjBorljnceMUEbvnMEqK0qIc1A6UAnYQS5/6Md4jTNxlhGUkKRYYBHmHCiEewJxQjzmmenFdphiXsZ0aKstogvmwkEiqwYml6MmS6kQkQKcUlICsIY6hyDAEbzupgZgr448/OouyI5Y3t8YgGfq5OIaHfeiZDWXclFizWw1OmF0lRQ4A8UWevnPTEsTNFjoQ7fV0UDq3SoSyBVgmU/FmOVsuz9VmfrCUBMPIMut4f1Dj9tzv4wqcmORzIvW1qwgOcYIC5vB0gzAClQW1EGuJXkgql2MlyuTHFhg4OAlrm8vRxtHrMFUhRV4trv/hawK3fqbF/QSwoYwSUPuCwlcDJ7y3wgeMKFHAYDgN7gOmwLBwGgxobzhnH/z7Txz9/exErpz2HK1teUZ+tTSGXZYZCFGAc3eqBZsESmZs1L0e92HK5TikSKA2N2CMY8QATfuvOgLOvqrBlW0CnyOioeWVF1/v4rXd7/M2fjeGEtQWGFO+FpkzFFPKOv/7zKXz/sR5m99foUJ2rRRNhhwCfAqBOxQkbVObHKSv14UZb2KnFdBAl5CdxvMwDcnotrTsW/vW9wPnXVdi2M+DwQ4DVK4CZSWDFVDp+aRkwNR7wxE8GOOuyWdz3vT7K0jMGyN8ToKTzFTMel2yYwPxcAJe56voR/eO7tOscY0Ls2GSFkJW+Nue8QTn6agJD6gta5mhwf7mHhCdesOGGCpu3AmMthzv+qsTHf6fArj0SP5YGKXNQZpleArRcjU9ePYdHnxgwPrAStK1EXkBhvO7scRx+aIleL2SWTzFP1qdQYkCs6dx66COob/28mB61GjzACwhmc9Q2rxnt/9GfUGwY1g4XfbHG488GjLWAmzYWOOU4zwAoKG6KteYG8YSAdunQKQM+dcMc9uwLbHnRv9Baumf5dIGPnNTB4jx5gQjNgisNLuH0Gr07ygKpjpdKsFnWGiuMXtLwfaPDpoRk/dFqjcYht6Q7P3lzhQefqvn87y4usOEjkgpjYlHhyT2psjMLErOcHANe3DbAXfd1xfUZVzRH6qMf/VA7E15JkfECdX9TiB+11ughDcisQGr4+wEfDqzrtegRxAau+aca3/gvEejK8z0uOcNhsUfWtAJGviOhrWKLXRwujgImx4Fvf3cR3V7gLGBRyDnfBbxnbQurVlImqJlEmdtLSpS/I9dACpD0l+I+sTjLCNbLe3sekHlEJry5/tJxh/98usZtDwo1vfTsAp/+mMeA0hrnPssalgl0PtoEEUYn18fbDltfHmLzlgEcs0MtiZ0oY+UKjyPWlBj0lRVGy3s+J2VQreKZIGUWq7MFDMEBaW01yMyoC7iRwmikG0zaZo5BcTwE9s0FXPS7Hp+/2DO356rQquKsvy9NDWV2yuXlM4Eb0O8FbN4ieTnCheIAKWLNao9qKPm/gJdD6bfhQkHlMLE9QmouF7Mlq1geM/hpO2xU/oNciT2K2B0Wik1/cHYu4Jz3O9y80bNXCOAJfnCzRAeguUhxbF0e7eLwMyIUKeW1HRkoWS9QXzPTnmWQvoOkQMED5Q8UDnDUE0ytLVv6jtbTyae6IP8T2qczNhKbAymLWP4nwXp94IhVDv9wWcGWoBRHHD/Fr8NPn6/Q8lpFpqCKwEgCGLsjF+4umOs3nZJeS8Y8ilrSHV0kazPqq6J5BRQylsgR4z2rALXhmWWkt8CAZvES49/aYDTZXsDxRzksnaDcTqAnz5DLtkqPux8c4LuPDTjfE9rnq0ziFUpotJfH4WFdjthUSbOjMdjFSXCtWg0EyyC9DU+fWcNq6UaDMq7tExJn6fFt3J+vKmPkZog9p4wqhoc6Dwvf8vjOfw9w+RcXucNj7e+0kpPa4wZmHDg1sHK5FAVCBXRgndb8XB2boj4TmBkgW9+AsLIOr/X6m/TX1uxjiyz3AOvjNQODMcVqb1GKrtrQ83qRQoCEf+SpITbeQJsSrLcnbhOR2zVZnBU0pXc46ghRAI+phMzGf3NnjRYBLOEPK8DzOxMheqcqFF5DIF+dyRZIYkhEgpJiNmn7wGIokhlLXWzNlEeHKvyTm4f4o+sWsdgNWHuUx2RHlG2KYDfniSaGyIUMMb4Zz/k+F5pGpyKp263x6v9VaBOztNyv40RmqGsG3o30+SMQZvXBAQsdb/UaJVTRdaVHZ2sPY22HzS9WuPDaLnbuqnHWySUe+vIU/uCjbcxRIUPpylKfeQMjuLTHF+drHH9sC2tWlxxGRKJiFADY/nKFXTsqjLUpE2jsx3Qq6C8A6CQEuP2V1wCNNfpmamvG/wg6amzLOmESPh+D0P7FVwMuuHoRW7dXOP19JW79zDjaLWBqQsLGipXo9jpZa2tTuG742EQmtKZSpcU/+VEf3fmANhVDbHnJGpEa8zUnxVK+o8N4fFx/H2F/MSXl3VvrBzhqUUmIJHdNedyAcfvrARdc08WzL9U4+bgSt181jjEFP1tljiVsrOHFAzothz27a5xx6jhOfn8HVUVU12YkvUR6/c/DPXQKEi4VPkyIuDrMiqNA3pbz/tGV29j3N68QetLweWuKKEOjdjMpsMX8Sb6nt2VLgCd/VuHMK4Z44ZUK7z26wJ1Xj2N6ynGKHOvYjhR6XumrKpFkbBfAnjcrrD2mhc9dORXpb5wJhULh8dzPB9j0wwEmlxDZMM9JyC9VoGQmz7wgU0Bc089dfqRCPKApqqsutCRGrarTf8PhjT0Bu2cDdu8L2LOvxu69AbP7A3a8UeEXWyu86zCPr187jjWHNFtclvqoFUZkiRRKf6/fDdj1eoXf/PUObrtlBstnpIVH1aB5IydBB3zr6wvodym/Sy9AKG8qi1NPgOixk7XBfJ0ub2o2lJBVdY2YsK6MFiWfO9/jnSuBHz1HHuGFSmuKC5XH6uUOHz+jhdUrndQChSiBXtTEoLRHQFj1a47bibbDrxxR4twzx7Bh/QTKlvCHKLzyf+oSbX66j0f/vYtlU1K/MAFSdyceEIVXAxdxeVy5fwPtRxHd9vw0GqBqIn4zWhpw4akeF5769gmDeADFr1mOXq/urHkN8Nyzx3DGKR20yoBDVhQ4+siSFUVWr014fZCUTue9bsCXrtsfOQIxWxNamiAKiOwZojxPHmBr75a/Y2hpP988pMEHYsfT1u0TEaFTyvMCS9m9htTWpIwlMMWuw8JizV3do99Z4PNXTnHLK9UXQemz4/rBhmW84naYw99fuw/PbR5g5XTBniwIT9bWuHcS+8YraAAfGyIZBlgGyHd45fv4UsTZW+rGmB7KghoVQkqK/J1XeEiIlLRJWRQ+DzzSx8+2DHHqB9osfK9Xs9DkKZRdpAucApDcXsb2uOX6WTz0r4tYQcIPc0HT59QBSpmgsBCILa98BSfb0jKa7jMAOEhTJOmGU2C85BCoINEvyT9IwHbL49WdFW68bZ6Xu9afPcZ3m+KUPFiASQiQkkuP/ftr3PS3s3j4/i73Aql+sc4vC6+rQIL2Qs+NY6QQqG0zZEZYLC2mYowfokVN1n6dGg/NV8YPzF1iBORlFK36BLS956XuP/3sPjy7ZYDL/2QJjv3VEr2+FDK8yKrZIa0byvS//0gPt39pDttfqHiVF4NEm2PDU0tgvpZ7AdMXMUZpW1Kb+4GaqY8+twpgx96A+x4PuPjDsmB54GukX3DQl1yfXwDuf7SHm766gJdfGeIPf38c11wxxd91aO/BQV673qjw1BMDPPhvi3j6yT7GSoeZZbKIa2UyNb3yJqitBebub6tPnosj22010rsf3exEgDNRAld9o8aPX3B412rdB2xgl1Hf0CiEMseoA3r9gG3bK/xw0wAvbB1iqkMkyeOw1QW+9s0FDAeCFeIwAYNewK5dNV7ZWmHb80O8uaNmUrR0Uqo6WgITmptITlRAg1LnZMiIEODec8MwkDV4707+A4isCHJD2cNr3GDfHLi/Z3v4448Xsj38EiepEOLqTru8RaDdHeDtLrZldn6/LnHbhLlNpwQmAB3vMNFxGOPtNZrmaqvzpbYXzm/ARyWvl4YIdYbU/Rn4CFMqYGq5ly0yVqUdUMnZ6q4Bl94zM2E9xGztTxc045aavK1Of1wxxQWiqDULYJuj6G/QEje7byAl6IT1YAF0H7HsKpUmjVV4eakcra6rwlIP6DJYtkbA6Ri8P0CB1jYv5u2lvBoULsfnnJpG9vCyIEqWZHeJrjJn48adGrzzSyZgGxek2ySeZqFjz3FjNd/vo0JKw8QEVgVqt0iKH1sDlBTKy+r6TLBx6nwFuPGefpMTc79Z3RRkPXw+H21njVSPcQ9fanXbWLymb/1/29RgkKmNTRuLBVXrxx0m+lkENmVY7S/zEWtrb9BWiRxlgZGCJ+a9PLHlfEDBTP2hsTFRdpVJNWdPx21qWVPDWtP5ik+j4Zn176wFzoWN9fcyoDNhI+dXppkA0XoCTQLEPCAIdhxk5Tur+nWPsChKYzxH97h/37aqm+z2Sw7ZvGRa5x5c3IuUlBBbVBYWBlymuEx4Gyuv74X4pDTXYILWD8ja4zRKYVR49Fcdxg3invt8yUsVJCRPHshrBWNZ+R49UYLt5tYfRcR6Xy0c3Ta5dJ6/Zd/vCNjlxCcueCa2l1pgGQDGzpIVSEPMyq6w5q+wzOoNUIzu0uz0SFhkHlHTiq4InO4zr9ENSjHO841N2e5ui3PrBTZQPFlagC0Jb54Vd4pZqNiOttgPoI4AZn1ZYLPzLoQatS2CNmod3T3W7Asc+Puc5D1JKRbpRJnFYgZAI9iQub7EvY9gxc9yW1vW+HgME3KkwSkNDs0EVnXqWqARIG3X1y3XDq0xbPbTS4q7vVcCN7qwGWM73/HV3P0t7iwImoOhlMZpe0rc8q7tblaE9vxzJaTCJa3nC/iZp6QFTgNGi/0mC9TvOTukUNLUG8Y6hZte7e/2l52Iu8ar6qXalR6hrhq5P0+LI7/DaYBgrHnMve1HEhYu6RkWgq2bvKDJ3cVGOfhZLOdYkaq8xPIYX2zVV72uyPBEN01XnTDuy2WLL33w+rG7/PpT3NyvrQ4bx9tww8qT1ejHNHFPQEJ6Ke0E1LJd2FmhR90g04xpP+tfKCjmYKaWIU/ImhcpTpXi2q7UfLeH9fXVqSVsTNiMD+Rh4uraDT2mlpXu8BNaG1etcnN+3T2huPcvWg8dubS6dHJJUfD6bFVXrq5rrw3+tCaXOuGmBENzAzHpu0tvL63uNj8bykdeoCkt8QHL+SqAkRxz60wJcQ9BFh6p7CX8CYEQLtShKocTfmbpRLHs3d1LT7u+9dA99tNZ+yHxBTcNztz0mr9x74I/hnZXhD7F/PCAn6bJz+U0vrPr7K5VJUJZf5/v040NDcG02LGGJVmfOsuxdifg03U9vUZHrPz0fl7p5caGjNkiEmTFUXBooUDbjWGs5TE+Pdyy6vjqijO+MPYACb+efjwdiYsqIewMk+d8tbro1b1uXXehPrYahmn+hZmGgtefqsalNFvU1BpAhM8QXhUlCmgCmihAUnBUQixk6J2eSYqwvM9Iz5sfrApM7LDF7W651oILbef3Tky0Nk2vcfeed0dxp3Nu7h6EYr2sgOL/Aa5OuMdnE5sWAAAAAElFTkSuQmCC";
    var SETTINGS_CSS = ".dsm-model-settings{display:flex;flex-direction:column;gap:14px;margin:0;padding:0}.dsm-model-settings-list{display:flex;flex-direction:column;gap:10px}.dsm-model-settings-route{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end;padding:10px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#202126)}.dsm-model-settings-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-model-settings-select{width:100%;max-width:220px;height:32px;padding:0 28px 0 10px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#232529);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;line-height:1.5}.dsm-model-settings-select:focus{outline:2px solid var(--dsw-alias-state-business-primary,#5686fe);outline-offset:1px}.dsm-model-settings-select:disabled{color:var(--dsw-alias-label-tertiary,#999);cursor:default}.dsm-model-settings-remove{height:32px;min-width:32px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#b8b8b8);cursor:pointer;font-size:16px;line-height:1}.dsm-model-settings-remove:hover{color:var(--dsw-alias-state-error-primary,#ef4444);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(242,90,90,.15))}.dsm-model-settings-options{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dsm-model-settings-strategy{display:flex;align-items:center;gap:8px;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-model-settings-strategy .dsm-model-settings-select{max-width:150px}.dsm-model-settings-footer{border-top:1px solid var(--dsw-alias-border-l2,#36373b);display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px}.dsm-model-settings-footer-status{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#b8b8b8);font-size:12px;line-height:1.5}.dsm-model-settings-footer-error{flex:1;min-width:0;color:var(--dsw-alias-label-error,#ef4444);font-size:12px;line-height:1.5}.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}.dsm-btn:disabled{opacity:.4;cursor:default}.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent}.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dsm-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dsm-btn-primary:hover:not(:disabled){opacity:.9}.dsm-model-settings-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}.dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;transition:transform .16s}.dsm-plugin-card-chevron-open{transform:rotate(180deg)}.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}.dsm-plugin-card-body .dsm-model-settings{margin:0;padding:12px 0 0;background:transparent;border:0;border-radius:0}.dsm-plugin-card-body .dsm-model-settings-head{display:none}.dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}";

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
      "row.save": "保存",
      "row.saved": "已保存",
      "row.incomplete": "请为每个模型路由选择 Provider 和 Model。",
      "row.saveFailed": "保存失败，请重试。",
      "row.toastSaved": "子代理默认模型设置已保存。"
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
      "row.save": "Save",
      "row.saved": "Saved",
      "row.incomplete": "Choose a provider and model for every route.",
      "row.saveFailed": "Could not save the setting. Try again.",
      "row.toastSaved": "Subagent default model settings saved."
    };

    // ── helpers ──────────────────────────────────────────────────────────
    var SUBAGENT_MODEL_SETTINGS_NS = "subagent-default-model";

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

    function serializeDefaultModels(previousValue, routes, strategy) {
      var next = Object.assign({}, previousValue || {});
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

    function persistDefaultModels(scope, value) {
      return Promise.resolve().then(function () { return scope.set("provider", value.provider); }).then(function () {
        return scope.set("model", value.model);
      }).then(function () {
        return scope.set("models", value.models);
      }).then(function () {
        return scope.set("strategy", value.strategy);
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
        var nextValue = serializeDefaultModels(value, routesState[0], strategyState[0]);
        savedState[1](false);
        saveErrorState[1](false);
        busyState[1](true);
        Promise.resolve().then(function () {
          return props.write(nextValue);
        }).then(function () {
          var accepted = props.settingsScope.getSnapshot();
          var acceptedValue = (accepted && accepted.status === "ready" && accepted.value) || {};
          if (acceptedValue.provider !== nextValue.provider || acceptedValue.model !== nextValue.model || acceptedValue.strategy !== nextValue.strategy || (acceptedValue.reasoningEffort || "") !== (nextValue.reasoningEffort || "") || JSON.stringify(acceptedValue.models || []) !== JSON.stringify(nextValue.models || [])) {
            throw new Error("settings write was not accepted");
          }
          routesState[1](normalizeDefaultModels(acceptedValue));
          strategyState[1](acceptedValue.strategy === "random" ? "random" : "round-robin");
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
        dirtyState[1](false);
        savedState[1](false);
        saveErrorState[1](false);
        toastState[1](null);
      }
      var hasIncompleteRoute = routesState[0].some(function (route) { return !route.provider || !route.model; });
      var saveDisabled = !snap || snap.status !== "ready" || snap.writable === false || busyState[0] || hasIncompleteRoute;
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
          }, "\u00d7")
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
        hasIncompleteRoute ? React.createElement("div", { className: "dsm-model-settings-hint" }, t("row.incomplete")) : null,
        React.createElement("div", { className: "dsm-model-settings-footer" },
          savedState[0] ? React.createElement("span", { className: "dsm-model-settings-footer-status" }, t("row.saved")) : (saveErrorState[0] ? React.createElement("span", { className: "dsm-model-settings-footer-error", role: "alert" }, t("row.saveFailed")) : null),
          React.createElement("button", { type: "button", className: "dsm-btn dsm-btn-outline", disabled: discardDisabled, onClick: discard }, t("row.discard")),
          React.createElement("button", { type: "button", className: "dsm-btn dsm-btn-primary", disabled: saveDisabled, onClick: save }, busyState[0] ? t("row.save") + "\u2026" : t("row.save"))
        ),
        toastState[0] ? React.createElement(Toast, { key: toastState[0].seq, text: toastState[0].text, onDone: function () { toastState[1](null); } }) : null
      );
    }

    // ── SubagentModelCard: collapsible card shell (default collapsed) ─────
    function SubagentModelCard(props) {
      var openState = React.useState(false);
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
          "aria-label": title,
          onClick: function () { setOpen(!open); }
        },
          React.createElement("img", { className: "dsm-plugin-card-icon", src: DSM_ICON, alt: "" }),
          React.createElement("span", { className: "dsm-plugin-card-head" },
            React.createElement("span", { className: "dsm-plugin-card-title" }, title),
            React.createElement("span", { className: "dsm-plugin-card-description" }, description)
          ),
          React.createElement("span", { className: "dsm-plugin-card-chevron" + (open ? " dsm-plugin-card-chevron-open" : "") }, "\u25be")
        ),
        React.createElement("div", { className: "dsm-plugin-card-body", hidden: !open },
          React.createElement(SubagentModelRow, props)
        )
      );
    }

    // ── apply: inject settings row ───────────────────────────────────────
    var inject = ["sessions", "connection", "slots", "locale", "settingsScope", "remote"];

    function apply(ctx) {
      var api = ctx.connection.api;

      // Register locale for this component
      ctx.locale.register(SUBAGENT_ROW_LOCALE, "zh", SUBAGENT_ROW_ZH);
      ctx.locale.register(SUBAGENT_ROW_LOCALE, "en", SUBAGENT_ROW_EN);

      var subagentScope = ctx.settingsScope.bind({ namespace: SUBAGENT_MODEL_SETTINGS_NS });
      var subagentRowInjected = function () {
        return {
          settingsScope: subagentScope,
          loadCatalog: function () {
            return api.llm.models({}).then(function (r) {
              if (!r.result.ok) throw new Error("llm.models failed: " + r.result.error.code);
              return r.result.value.groups || [];
            });
          },
          write: function (value) {
            return persistDefaultModels(subagentScope, value);
          }
        };
      };

      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          key: "subagent-default-model",
          locale: SUBAGENT_ROW_LOCALE,
          inject: subagentRowInjected
        }, SubagentModelCard);
      });
    }

    return { apply: apply, inject: inject };
  }
});
