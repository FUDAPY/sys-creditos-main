type AppFooterProps = {
  linkClassName?: string;
  textClassName?: string;
};

export const AppFooter = ({
  linkClassName = 'text-blue-400 hover:underline',
  textClassName = 'text-xs text-gray-500',
}: AppFooterProps) => {
  return (
    <p className={textClassName}>
      © Todos los derechos reservados - OTELAX DEV de GRUPO OTELAX HOLDING url:{' '}
      <a
        href="https://www.dev.otelax.com"
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        www.dev.otelax.com
      </a>
    </p>
  );
};
