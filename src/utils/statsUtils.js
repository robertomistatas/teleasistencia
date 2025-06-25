// Constantes
export const ESTADOS = {
    AL_DIA: 'al-dia',
    PENDIENTE: 'pendiente',
    URGENTE: 'urgente'
};

// Validar si una llamada fue exitosa
export const isLlamadaExitosa = (comentarios) => {
    if (!comentarios || typeof comentarios !== 'string') return false;
    const comentariosLower = comentarios.toLowerCase().trim();
    return [
        'exitoso',
        'exitosa',
        'contesta',
        'contactado',
        'contactada',
        'se logra contactar',
        'responde'
    ].some(term => comentariosLower.includes(term));
};

// Validar y convertir una llamada individual
export const validateLlamada = (llamada) => {
    if (!llamada || typeof llamada !== 'object') return null;
    return {
        fecha: llamada.fecha || null,
        hora: llamada.hora || null,
        duracion: typeof llamada.duracion === 'number' ? llamada.duracion : 0,
        tipo: llamada.tipo || '',
        telefono: llamada.telefono || '',
        teleoperadora: llamada.teleoperadora || '',
        comentarios: llamada.comentarios || ''
    };
};

// Validar y convertir un array de llamadas
export const validateLlamadas = (llamadas) => {
    if (!Array.isArray(llamadas)) return [];
    return llamadas.map(validateLlamada).filter(Boolean);
};

// Crear estado inicial para las métricas
export const createInitialStats = () => ({
    totalLlamadas: 0,
    entrantes: 0,
    salientes: 0,
    duracionTotal: 0,
    duracionPromedio: 0,
    beneficiarios: new Set(),
    llamadasPorBeneficiario: {},
    ultimasLlamadas: {},
    llamadasExitosas: {},
    beneficiariosAlDia: new Set(),
    beneficiariosPendientes: new Set(),
    beneficiariosUrgentes: new Set(),
    comunas: new Map(),
    teleoperadoras: {}
});

// Convertir datos almacenados a estado válido
export const parseStoredStats = (storedStats) => {
    if (!storedStats || typeof storedStats !== 'object') return createInitialStats();

    const stats = createInitialStats();

    try {
        // Métricas numéricas básicas
        stats.totalLlamadas = storedStats.totalLlamadas || 0;
        stats.entrantes = storedStats.entrantes || 0;
        stats.salientes = storedStats.salientes || 0;
        stats.duracionTotal = storedStats.duracionTotal || 0;
        stats.duracionPromedio = storedStats.duracionPromedio || 0;

        // Conjuntos
        stats.beneficiarios = new Set(storedStats.beneficiarios || []);
        stats.beneficiariosAlDia = new Set(storedStats.beneficiariosAlDia || []);
        stats.beneficiariosPendientes = new Set(storedStats.beneficiariosPendientes || []);
        stats.beneficiariosUrgentes = new Set(storedStats.beneficiariosUrgentes || []);

        // Comunas
        stats.comunas = new Map(Object.entries(storedStats.comunas || {}));

        // Llamadas por beneficiario
        if (storedStats.llamadasPorBeneficiario) {
            Object.entries(storedStats.llamadasPorBeneficiario).forEach(([beneficiario, datos]) => {
                if (datos && Array.isArray(datos.llamadas)) {
                    stats.llamadasPorBeneficiario[beneficiario] = validateLlamadas(datos.llamadas);
                }
            });
        }

        // Últimas llamadas
        if (storedStats.ultimasLlamadas) {
            Object.entries(storedStats.ultimasLlamadas).forEach(([beneficiario, llamada]) => {
                const validatedLlamada = validateLlamada(llamada);
                if (validatedLlamada) {
                    stats.ultimasLlamadas[beneficiario] = validatedLlamada;
                }
            });
        }

        // Llamadas exitosas
        if (storedStats.llamadasExitosas) {
            Object.entries(storedStats.llamadasExitosas).forEach(([beneficiario, llamadas]) => {
                stats.llamadasExitosas[beneficiario] = validateLlamadas(llamadas);
            });
        }

        // Teleoperadoras
        stats.teleoperadoras = storedStats.teleoperadoras || {};

        return stats;
    } catch (error) {
        console.error('Error parsing stored stats:', error);
        return createInitialStats();
    }
};
