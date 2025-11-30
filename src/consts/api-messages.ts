/**
 * Mensajes de API centralizados
 *
 * NOTA: Actualmente en español. Preparado para migración futura a i18n.
 * Cuando se implemente i18n en APIs, estos mensajes se moverán a
 * src/utils/i18n.ts siguiendo el patrón existente.
 */
export const API_MESSAGES = {
	ERRORS: {
		// Genéricos
		INTERNAL_ERROR: 'Error interno del servidor',
		UNAUTHORIZED: 'No autorizado',
		FORBIDDEN: 'Acceso denegado',
		NOT_FOUND: 'Recurso no encontrado',
		INVALID_REQUEST: 'Solicitud inválida',

		// Usuarios
		USER_NOT_FOUND: 'Usuario no encontrado',
		BUILDER_NOT_FOUND: 'Builder no encontrado',
		INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos',
		USERNAME_ALREADY_EXISTS: 'El nombre de usuario ya existe',
		INVALID_USERNAME: 'Usuario inválido. Usa 3-20 caracteres alfanuméricos, guiones o puntos',

		// Tickets
		TICKET_NOT_FOUND: 'Ticket no encontrado',
		TICKET_CODE_INVALID: 'Código de ticket inválido',
		TICKET_CODE_EXISTS: 'El código de ticket ya existe',
		TICKET_ALREADY_USED: 'El ticket ya fue utilizado',
		TICKET_EXPIRED: 'El ticket ha expirado',

		// Créditos
		INSUFFICIENT_CREDITS: 'Créditos insuficientes',
		CREDITS_DEDUCTION_ERROR: 'Error al procesar los créditos',
		INVALID_CREDIT_AMOUNT: 'Cantidad de créditos inválida',

		// Sesiones
		SESSION_EXPIRED: 'Sesión expirada',
		INVALID_SESSION: 'Sesión inválida',
	},

	SUCCESS: {
		TICKET_CREATED: 'Ticket creado exitosamente',
		TICKET_UPDATED: 'Ticket actualizado exitosamente',
		TICKET_DELETED: 'Ticket eliminado exitosamente',

		BUILDER_CREATED: 'Builder creado exitosamente',
		BUILDER_UPDATED: 'Builder actualizado exitosamente',
		BUILDER_DELETED: 'Builder eliminado exitosamente',

		CREDITS_ADJUSTED: 'Créditos ajustados exitosamente',
		CREDITS_CLAIMED: 'Créditos reclamados exitosamente',

		ACCOUNT_CREATED: 'Cuenta creada exitosamente',

		LOGIN_SUCCESS: 'Inicio de sesión exitoso',
		LOGOUT_SUCCESS: 'Sesión cerrada exitosamente',
	},
} as const
