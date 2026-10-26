import { PageHeader } from '../components/core';

export default function Placeholder({ title }: { title: string }): JSX.Element {
  return <PageHeader title={title} lede="This section is being built." />;
}
