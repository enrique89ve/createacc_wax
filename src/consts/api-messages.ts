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
    INVALID_ID: 'ID inválido',
    SERVER_CONFIG_ERROR: 'Error de configuración del servidor',

    // Usuarios
    USER_NOT_FOUND: 'Usuario no encontrado',
    BUILDER_NOT_FOUND: 'Builder no encontrado',
    INVALID_CREDENTIALS: 'Credenciales inválidas',
    CREDENTIALS_REQUIRED: 'Credenciales requeridas',
    USERNAME_ALREADY_EXISTS: 'El nombre de usuario ya existe',
    INVALID_USERNAME:
      'Usuario inválido. Usa 3-20 caracteres alfanuméricos, guiones o puntos',
    USERNAME_MIN_LENGTH: 'Hive username debe tener al menos 3 caracteres',
    BUILDER_ALREADY_EXISTS: 'El builder ya existe',
    INVALID_USER_ID: 'ID de usuario inválido',
    ADMIN_ONLY: 'Acceso restringido a administradores',
    BUILDERS_ONLY: 'Solo los builders pueden reclamar créditos',
    CANNOT_DELETE_ADMIN: 'No se puede eliminar el único administrador',
    INVALID_IS_ACTIVE: 'is_active debe ser booleano',
    BUILDER_ID_INVALID: 'ID de builder inválido',
    CANNOT_DETERMINE_CREATOR: 'No se pudo determinar el creador del ticket',
    UNAUTHORIZED_DELETE_TICKET: 'No autorizado para eliminar este ticket',

    // Tickets
    TICKET_NOT_FOUND: 'Ticket no encontrado',
    TICKET_CODE_INVALID: 'Código de ticket inválido',
    TICKET_CODE_EXISTS: 'El código ya existe',
    TICKET_ALREADY_USED: 'El ticket ya fue utilizado',
    TICKET_EXPIRED: 'El ticket ha expirado',
    TICKET_INVALID: 'Ticket inválido',
    TICKET_ID_INVALID: 'ID de ticket inválido',
    TICKET_CANNOT_DELETE_USED:
      'No se puede eliminar un ticket que ha sido usado',
    TICKET_ALREADY_EXISTS: 'Ya existe un ticket con ese código',

    // Créditos
    INSUFFICIENT_CREDITS: 'Créditos insuficientes',
    CREDITS_DEDUCTION_ERROR: 'Error al procesar los créditos',
    CREDITS_REFUND_ERROR: 'Error al devolver créditos',
    INVALID_CREDIT_AMOUNT: 'Cantidad de créditos inválida',
    CREDITS_RECORD_NOT_FOUND: 'Registro de créditos no encontrado',
    CREDITS_PENDING_CHANGED:
      'La cantidad de créditos pendientes ha cambiado o es insuficiente',
    INVALID_CLAIM_CODE: 'Código de claim inválido',

    // Sesiones
    SESSION_EXPIRED: 'Sesión expirada',
    INVALID_SESSION: 'Sesión inválida',

    // Validación blockchain
    TRANSACTION_ID_AND_HASH_REQUIRED: 'Transaction ID y hash son requeridos',
    HASH_NOT_FOUND: 'Hash de validación no encontrado, inválido o expirado',
    TRANSACTION_INVALID: 'Transacción inválida',
    USERNAME_NOT_SPECIFIED: 'Username no especificado',
  },

  SUCCESS: {
    TICKET_CREATED: 'Ticket creado exitosamente',
    TICKET_UPDATED: 'Ticket actualizado exitosamente',
    TICKET_DELETED: 'Ticket eliminado exitosamente',

    BUILDER_CREATED: 'Builder creado exitosamente',
    BUILDER_CREATED_WITH_CREDITS:
      'Builder creado exitosamente con 100 créditos pendientes',
    BUILDER_UPDATED: 'Builder actualizado exitosamente',
    BUILDER_DELETED: 'Usuario eliminado exitosamente',

    CREDITS_ADJUSTED: 'Créditos ajustados exitosamente',
    CREDITS_CLAIMED: 'Créditos reclamados exitosamente',

    ACCOUNT_CREATED: 'Cuenta creada exitosamente',

    LOGIN_SUCCESS: 'Inicio de sesión exitoso',
    LOGOUT_SUCCESS: 'Sesión cerrada exitosamente',
  },
} as const
