(function() {
    // 1. Inyectar automáticamente los estilos CSS con control estricto de visibilidad (Reducido un 25%)
    const style = document.createElement('style');
    style.innerHTML = `
        #tecladoFlotante {
            position: fixed;
            width: 100%;
            max-width: 375px;
            background-color: #e8eaed;
            box-shadow: 0 -6px 20px rgba(0,0,0,0.25);
            padding: 9px;
            z-index: 20000;
            margin: 0 auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            box-sizing: border-box;
            display: block;
        }
        #tecladoFlotante * { box-sizing: border-box; }
        
        #tecladoFlotante.teclado-oculto {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
        
        /* Posiciones preestablecidas */
        #tecladoFlotante.pos-bottom-center { bottom: 0; left: 0; right: 0; border-radius: 12px 12px 0 0; }
        #tecladoFlotante.pos-bottom-left { bottom: 15px; left: 15px; right: auto; border-radius: 12px; }
        #tecladoFlotante.pos-bottom-right { bottom: 15px; right: 15px; left: auto; border-radius: 12px; }
        #tecladoFlotante.pos-top-center { top: 15px; left: 0; right: 0; border-radius: 12px; }
        #tecladoFlotante.pos-center { top: 50%; left: 50%; right: auto; bottom: auto; transform: translate(-50%, -50%); border-radius: 12px; }

        /* Menú contextual de posiciones */
        .menu-posiciones {
            position: absolute;
            bottom: 56px;
            left: 11px;
            background: #ffffff;
            border-radius: 10px;
            box-shadow: 0 3px 15px rgba(0,0,0,0.15);
            padding: 7px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            z-index: 20010;
        }
        .menu-posiciones.menu-oculto { display: none !important; }
        .menu-fila { display: flex; gap: 4px; align-items: center; }
        .menu-posiciones button {
            width: 28px; height: 28px; border: none; background-color: #f0f2f5; color: #333;
            border-radius: 6px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .menu-posiciones button:hover { background-color: #e2e8f0; }

        /* Grilla del teclado */
        .teclado-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; max-width: 338px; margin: 0 auto; }
        .teclado-grid button {
            height: 39px; font-size: 16px; border: none; border-radius: 7px; background-color: #ffffff;
            color: #1e293b; cursor: pointer; touch-action: manipulation; display: flex; justify-content: center;
            align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); user-select: none; font-weight: 600;
        }
        .teclado-grid button:active { background-color: #cbd5e1; }
        .btn-funcion { background-color: #cbd5e1 !important; font-size: 14px !important; color: #334155 !important; }
        .btn-ok { background-color: #0d9488 !important; color: white !important; font-weight: bold; font-size: 14px !important; }
        .text-blue { color: #0d9488 !important; }
        .btn-drag { background-color: #cbd5e1 !important; cursor: pointer; }
        .btn-drag svg { width: 16px; height: 16px; stroke: #334155; }
    `;
    document.head.appendChild(style);

    // 2. Inyectar HTML del teclado oculto por defecto
    const container = document.createElement('div');
    container.innerHTML = `
        <div id="tecladoFlotante" class="teclado-oculto pos-bottom-center">
            <div id="menuPosiciones" class="menu-posiciones menu-oculto">
                <button type="button" data-pos="top-center" title="Arriba">▲</button>
                <div class="menu-fila">
                    <button type="button" data-pos="bottom-left" title="Izquierda">◀</button>
                    <button type="button" data-pos="center" title="Centro">●</button>
                    <button type="button" data-pos="bottom-right" title="Derecha">▶</button>
                </div>
                <button type="button" data-pos="bottom-center" title="Abajo">▼</button>
            </div>
            <div class="teclado-grid">
                <button type="button" data-key="1">1</button>
                <button type="button" data-key="2">2</button>
                <button type="button" data-key="3">3</button>
                <button type="button" data-key="backspace" class="btn-funcion">⌫</button>
                <button type="button" data-key="4">4</button>
                <button type="button" data-key="5">5</button>
                <button type="button" data-key="6">6</button>
                <button type="button" data-key="sign" class="btn-funcion text-blue">Sig.</button>
                <button type="button" data-key="7">7</button>
                <button type="button" data-key="8">8</button>
                <button type="button" data-key="9">9</button>
                <button type="button" data-key="." class="btn-funcion">.</button>
                <button type="button" id="dragHandle" class="btn-drag" title="Cambiar posición">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="5 9 2 12 5 15"></polyline>
                        <polyline points="9 5 12 2 15 5"></polyline>
                        <polyline points="15 19 12 22 9 19"></polyline>
                        <polyline points="19 9 22 12 19 15"></polyline>
                        <line x1="2" x2="22" y1="12" y2="12"></line>
                        <line x1="12" x2="12" y1="2" y2="22"></line>
                    </svg>
                </button>
                <button type="button" data-key="0">0</button>
                <button type="button" data-key="," class="btn-funcion">,</button>
                <button type="button" data-key="enter" class="btn-ok">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(container);

    // 3. Lógica con pointerdown para detectar toques en inputs readonly
    function initTeclado() {
        let activeInput = null;
        const teclado = document.getElementById('tecladoFlotante');
        const menuPosiciones = document.getElementById('menuPosiciones');
        const dragHandle = document.getElementById('dragHandle');
        const botonesPos = menuPosiciones.querySelectorAll('button[data-pos]');
        const botones = teclado.querySelectorAll('button[data-key]');

        document.addEventListener('pointerdown', (e) => {
            const targetInput = e.target.closest('[data-teclado]');
            if (targetInput) {
                activeInput = targetInput;
                teclado.classList.remove('teclado-oculto');
                targetInput.focus();
            }
        });

        dragHandle.addEventListener('click', (e) => {
            e.stopPropagation();
            menuPosiciones.classList.toggle('menu-oculto');
        });

        botonesPos.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const nuevaPos = btn.getAttribute('data-pos');
                teclado.classList.remove('pos-bottom-center', 'pos-bottom-left', 'pos-bottom-right', 'pos-top-center', 'pos-center');
                teclado.classList.add(`pos-${nuevaPos}`);
                menuPosiciones.classList.add('menu-oculto');
            });
        });

        botones.forEach(boton => {
            boton.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                if (!activeInput) return;
                
                const key = boton.getAttribute('data-key');
                let valorActual = activeInput.value || '';
                const isCurrencyInput = activeInput.id.includes('venta') || (activeInput.placeholder && activeInput.placeholder.includes('$'));

                if (key === 'backspace') {
                    if (isCurrencyInput) {
                        let digits = valorActual.replace(/[^0-9]/g, '');
                        digits = digits.slice(0, -1);
                        activeInput.value = digits === '' ? '' : digits;
                        if (typeof window.formatCurrencyInput === 'function' && activeInput.value !== '') {
                            window.formatCurrencyInput(activeInput);
                        }
                    } else {
                        activeInput.value = valorActual.slice(0, -1);
                    }
                } else if (key === 'enter') {
                    if (isCurrencyInput && typeof window.formatCurrencyInput === 'function') {
                        window.formatCurrencyInput(activeInput);
                    }
                    teclado.classList.add('teclado-oculto');
                    menuPosiciones.classList.add('menu-oculto');
                    activeInput.blur();
                    activeInput = null;
                } else if (key === 'sign') {
                    if (valorActual.startsWith('-')) {
                        activeInput.value = valorActual.substring(1);
                    } else if (valorActual !== '' && valorActual !== '0' && valorActual !== '$0.00') {
                        activeInput.value = '-' + valorActual;
                    }
                } else if (key === '.' || key === ',') {
                    if (!valorActual.includes('.') && !valorActual.includes(',')) {
                        if (valorActual === '' || valorActual === '-') {
                            activeInput.value += '0' + key;
                        } else {
                            activeInput.value += key;
                        }
                    }
                } else {
                    if (isCurrencyInput) {
                        let digits = valorActual.replace(/[^0-9]/g, '');
                        if (digits === '0') digits = '';
                        digits += key;
                        activeInput.value = digits;
                        if (typeof window.formatCurrencyInput === 'function') {
                            window.formatCurrencyInput(activeInput);
                        }
                    } else {
                        if (valorActual === '0' && key !== '.') {
                            activeInput.value = key;
                        } else {
                            activeInput.value += key;
                        }
                    }
                }
                
                activeInput.dispatchEvent(new Event('input', { bubbles: true }));
                if (typeof window.calcularDiario === 'function') {
                    window.calcularDiario();
                }
                if (typeof window.autoGuardarPresupuesto === 'function') {
                    window.autoGuardarPresupuesto();
                }
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTeclado);
    } else {
        initTeclado();
    }
})();
