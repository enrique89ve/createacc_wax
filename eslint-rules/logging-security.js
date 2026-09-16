/**
 * ESLint rules para prevenir vulnerabilidades de logging
 * Detecta patrones inseguros en código de logging
 */

export default {
  'no-template-literals-in-logging': {
    meta: {
      type: 'security',
      docs: {
        description:
          'Previene uso de template literals en logging que pueden causar log injection',
        category: 'Security',
        recommended: true,
      },
      schema: [],
      messages: {
        templateLiteralInLog:
          'Evita template literals en mensajes de log. Usa mensajes estáticos y coloca datos en metadata.',
        sensitiveFieldInLog:
          'Campo sensible "{{field}}" detectado en logging. Usa funciones de sanitización.',
      },
    },
    create(context) {
      // Patrones de funciones de logging a verificar
      const loggingFunctions = new Set([
        'logger.info',
        'logger.warn',
        'logger.error',
        'auditLog.loginAttempt',
        'auditLog.sessionCreated',
        'auditLog.sessionDestroyed',
        'auditLog.routeProtected',
        'auditLog.authenticationError',
      ])

      // Campos sensibles que nunca deben aparecer en logs
      const sensitiveFields = new Set([
        'password_hash',
        'password',
        'token',
        'secret',
        'key',
        'sessionToken',
        'session_token',
        'raw', // Específicamente para el caso de password hash leakage
      ])

      function checkForSensitiveFields(node) {
        if (node.type === 'ObjectExpression') {
          for (const prop of node.properties) {
            if (prop.type === 'Property' && prop.key.type === 'Identifier') {
              if (sensitiveFields.has(prop.key.name)) {
                context.report({
                  node: prop,
                  messageId: 'sensitiveFieldInLog',
                  data: { field: prop.key.name },
                })
              }
            }
          }
        }
      }

      function isLoggingCall(node) {
        if (node.type === 'CallExpression') {
          if (node.callee.type === 'MemberExpression') {
            const object = node.callee.object
            const property = node.callee.property

            if (
              object.type === 'Identifier' &&
              property.type === 'Identifier'
            ) {
              const fullName = `${object.name}.${property.name}`
              return loggingFunctions.has(fullName)
            }
          }
        }
        return false
      }

      return {
        CallExpression(node) {
          if (isLoggingCall(node)) {
            // Verificar template literals en argumentos de mensaje
            for (let i = 0; i < node.arguments.length; i++) {
              const arg = node.arguments[i]

              // Detectar template literals
              if (arg.type === 'TemplateLiteral') {
                context.report({
                  node: arg,
                  messageId: 'templateLiteralInLog',
                })
              }

              // Verificar campos sensibles en metadata
              if (i >= 2) {
                // metadata suele ser el 3er argumento
                checkForSensitiveFields(arg)
              }
            }
          }
        },
      }
    },
  },

  'require-sanitized-logging': {
    meta: {
      type: 'security',
      docs: {
        description:
          'Requiere uso de funciones de sanitización para user input en logs',
        category: 'Security',
        recommended: true,
      },
      schema: [],
      messages: {
        requireSanitization:
          'User input "{{variable}}" debe ser sanitizado antes de logging. Usa sanitizeLogInput().',
      },
    },
    create(context) {
      // Variables que comúnmente contienen user input
      const userInputVariables = new Set(['username', 'path', 'error', 'ip'])

      function checkObjectForUnsanitizedInput(node) {
        if (node.type === 'ObjectExpression') {
          for (const prop of node.properties) {
            if (
              prop.type === 'Property' &&
              prop.key.type === 'Identifier' &&
              userInputVariables.has(prop.key.name)
            ) {
              // Verificar si el valor está siendo sanitizado
              if (
                prop.value.type === 'Identifier' ||
                prop.value.type === 'Literal' ||
                (prop.value.type === 'CallExpression' &&
                  prop.value.callee.name !== 'sanitizeLogInput')
              ) {
                context.report({
                  node: prop.value,
                  messageId: 'requireSanitization',
                  data: { variable: prop.key.name },
                })
              }
            }
          }
        }
      }

      return {
        CallExpression(node) {
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.object.name === 'logger'
          ) {
            // Verificar metadata (último argumento)
            const lastArg = node.arguments[node.arguments.length - 1]
            if (lastArg) {
              checkObjectForUnsanitizedInput(lastArg)
            }
          }
        },
      }
    },
  },
}
